import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;
const PASSWORD = "senha-de-teste-123";
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}@t.test`;

run("API — dashboard (agregados, consolidado, isolamento)", () => {
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof buildApp>;
  let orgA: string, orgB: string, p1: string, p2: string, pb: string;
  interface H { id: string; headers: Record<string, string> }
  let owner: H, boss1: H, boss2: H, op1: H, bossB: H;
  const plans: Record<string, string> = {};

  async function user(org: string, project: string | null, role: string, caps: string[], hdr: string | null): Promise<H> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [reg.json().id, org, project, role, caps]);
    return { id: reg.json().id, headers: { authorization: `Bearer ${token}`, ...(hdr ? { "x-project-id": hdr } : {}) } };
  }
  const post = (h: H, url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: h.headers, payload: payload as object });
  const get = (h: H, url: string) => app.inject({ method: "GET", url, headers: h.headers });

  async function seed(boss: H, op: H, key: string, orders: number, paid: number, total: number) {
    const prod = (await post(boss, "/v1/products", { name: key })).json().id;
    plans[key] = (await post(boss, `/v1/products/${prod}/plans`, { name: key, priceCents: total })).json().id;
    const aff = (await post(boss, "/v1/affiliates", { name: `Af-${key}` })).json().id;
    const ids: string[] = [];
    for (let i = 0; i < orders; i++) ids.push((await post(op, "/v1/orders", { planId: plans[key], affiliateId: aff, customer: { name: "C", address: { uf: "sp" } } })).json().id);
    for (const id of ids.slice(0, paid)) {
      await post(boss, `/v1/orders/${id}/transition`, { axis: "payment", from: "sem_status", to: "pendente" });
      await post(boss, `/v1/orders/${id}/transition`, { axis: "payment", from: "pendente", to: "pago" });
    }
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN });
    pool = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool, cpfKey: "f".repeat(64) });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    const mkOrg = async (nm: string) => (await admin.query("insert into organizations (name, slug) values ($1,$2) returning id", [nm, `${nm}-${Date.now()}-${n++}`])).rows[0].id as string;
    const mkProj = async (org: string, nm: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,$2,'pos-pago',1) returning id", [org, nm])).rows[0].id as string;
    orgA = await mkOrg("da"); orgB = await mkOrg("db");
    p1 = await mkProj(orgA, "Linha 1"); p2 = await mkProj(orgA, "Linha 2"); pb = await mkProj(orgB, "Outra Org");
    owner = await user(orgA, null, "org_admin", [], null);                 // enxerga os dois projetos
    boss1 = await user(orgA, p1, "project_admin", [], p1);
    boss2 = await user(orgA, p2, "project_admin", [], p2);
    op1 = await user(orgA, p1, "operator", PRESETS.mentorado_atendente!, p1);
    bossB = await user(orgB, pb, "project_admin", [], pb);
    await seed(boss1, op1, "L1", 4, 2, 10000);
    const op2 = await user(orgA, p2, "operator", PRESETS.mentorado_atendente!, p2);
    await seed(boss2, op2, "L2", 3, 3, 20000);
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  it("antes do refresh os agregados estão vazios e o painel avisa atraso", async () => {
    const d = (await get(boss1, "/v1/dashboard")).json();
    expect(d.total.orders).toBe(0);
    expect(d.anyStale).toBe(true);
    expect(d.byProject[0].refreshedAt).toBeNull();
  });

  it("refresh por projeto; leitura sem a capability é 403", async () => {
    expect((await post(op1, "/v1/dashboard/refresh")).statusCode).toBe(403);
    expect((await get(op1, "/v1/dashboard")).statusCode).toBe(403);
    expect((await post(boss1, "/v1/dashboard/refresh")).statusCode).toBe(200);
    expect((await post(boss2, "/v1/dashboard/refresh")).statusCode).toBe(200);
    expect((await post({ ...boss1, headers: { authorization: boss1.headers.authorization! } }, "/v1/dashboard/refresh")).statusCode).toBe(400);
  });

  it("projeto único: números e taxas corretos, sem vazar o outro projeto", async () => {
    const d = (await get(boss1, "/v1/dashboard")).json();
    expect(d.scope).toBe("project");
    expect(d.total).toMatchObject({ orders: 4, grossCents: 40000, paid: 2, paidCents: 20000 });
    expect(d.total.rates.conversionBps).toBe(5000);
    expect(d.byProject.map((p: { name: string }) => p.name)).toEqual(["Linha 1"]);
    expect(d.byUf[0]).toMatchObject({ uf: "SP", orders: 4 });
    expect(d.byAffiliate[0].name).toBe("Af-L1");
    expect(d.anyStale).toBe(false);
  });

  it("'Todos os projetos' consolida só o que o usuário pode ver e ranqueia por valor pago", async () => {
    const d = (await get(owner, "/v1/dashboard")).json();
    expect(d.scope).toBe("all");
    expect(d.total).toMatchObject({ orders: 7, paid: 5, paidCents: 20000 + 60000 });
    expect(d.byProject.map((p: { name: string }) => p.name)).toEqual(["Linha 2", "Linha 1"]); // 60000 > 20000
    expect(d.byProject.some((p: { name: string }) => p.name === "Outra Org")).toBe(false);
    // quem só administra o projeto 1, sem x-project-id, vê apenas o 1
    const only1 = (await get({ ...boss1, headers: { authorization: boss1.headers.authorization! } }, "/v1/dashboard")).json();
    expect(only1.byProject.map((p: { name: string }) => p.name)).toEqual(["Linha 1"]);
  });

  it("header de projeto alheio é 403; outra organização enxerga só a própria", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/dashboard", headers: { ...boss1.headers, "x-project-id": p2 } })).statusCode).toBe(403);
    const b = (await get(bossB, "/v1/dashboard")).json();
    expect(b.total.orders).toBe(0);
    expect((await post(bossB, "/v1/dashboard/refresh")).statusCode).toBe(200);
    expect((await get(bossB, "/v1/dashboard")).json().byProject.map((p: { name: string }) => p.name)).toEqual(["Outra Org"]);
  });

  it("valida o intervalo de datas", async () => {
    expect((await get(boss1, "/v1/dashboard?from=2026-13-40&to=2026-01-01")).statusCode).toBe(400);
    expect((await get(boss1, "/v1/dashboard?from=2026-02-01&to=2026-01-01")).statusCode).toBe(400);
    expect((await get(boss1, "/v1/dashboard?from=2020-01-01&to=2026-01-01")).statusCode).toBe(400);
  });

  it("CSV: cabeçalho, linhas do escopo e content-type", async () => {
    const r = await get(owner, "/v1/dashboard/export.csv");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    const lines = r.body.trim().split("\r\n");
    expect(lines[0]).toBe("projeto,dia,uf,afiliado,pedidos,bruto_centavos,pagos,pago_centavos,entregues,perdidos,devolvidos,inadimplentes");
    expect(lines.length).toBe(3); // 2 projetos x (1 dia, SP, 1 afiliado)
    expect(r.body).not.toContain("Outra Org");
  });
});
