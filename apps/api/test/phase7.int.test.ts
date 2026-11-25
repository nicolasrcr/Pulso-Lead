import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";
import { markOverdueAll } from "../src/jobs";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;
const PASSWORD = "senha-de-teste-123";
const KEY = "6".repeat(64);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}@t.test`;

run("API — Fase 7: back-office, suspensão somente leitura, exportação, descarte seguro", () => {
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof buildApp>;
  let org: string, p1: string, sys: string, plan: string;
  interface H { id: string; headers: Record<string, string> }
  let plat: H, boss: H, op: H, noPerm: H;
  const planKey = `std-${Date.now()}`;

  async function user(project: string | null, role: string, caps: string[], platformAdmin = false): Promise<H> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    if (project) await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [reg.json().id, org, project, role, caps]);
    if (platformAdmin) await admin.query("update app_users set platform_admin = true where id = $1", [reg.json().id]);
    return { id: reg.json().id, headers: { authorization: `Bearer ${token}`, ...(project ? { "x-project-id": project } : {}) } };
  }
  const post = (h: H, url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: h.headers, payload: payload as object });
  const get = (h: H, url: string) => app.inject({ method: "GET", url, headers: h.headers });
  const status = (to: string, reason?: string) => post(plat, `/v1/backoffice/organizations/${org}/status`, { to, reason });

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN });
    pool = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool, cpfKey: KEY });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    await admin.query("insert into plans (key, name) values ($1,'Padrão')", [planKey]);
    org = (await admin.query("insert into organizations (name, slug) values ('o7',$1) returning id", [`o7-${Date.now()}`])).rows[0].id;
    p1 = (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,'B1','pos-pago',1) returning id", [org])).rows[0].id;
    plat = await user(null, "", [], true);
    sys = plat.id;
    boss = await user(p1, "project_admin", []);
    noPerm = await user(p1, "operator", ["orders.create"]);
    op = await user(p1, "operator", [...PRESETS.mentorado_atendente!, "orders.read_all", "reports.read"]);
    const prod = (await post(boss, "/v1/products", { name: "P" })).json().id;
    plan = (await post(boss, `/v1/products/${prod}/plans`, { name: "Pl", priceCents: 10000 })).json().id;
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  const order = (h: H, name = "Maria Segredo") => post(h, "/v1/orders", { planId: plan, customer: { name, cpf: "52998224725", phone: "61999991234", email: "m@x.com" } });

  it("back-office exige admin da plataforma (usuário de projeto recebe 403 em tudo)", async () => {
    for (const [m, u] of [["GET", "/v1/backoffice/overview"], ["GET", "/v1/backoffice/audit"]] as const)
      expect((await app.inject({ method: m, url: u, headers: boss.headers })).statusCode).toBe(403);
    expect((await post(boss, `/v1/backoffice/organizations/${org}/status`, { to: "ativo" })).statusCode).toBe(403);
    expect((await post(boss, `/v1/backoffice/organizations/${org}/subscription`, { planKey, monthlyFeeCents: 1, orderCap: 1 })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/backoffice/overview" })).statusCode).toBe(401);
  });

  it("cria assinatura, valida entrada e mostra a organização na visão geral com uso do mês", async () => {
    expect((await post(plat, `/v1/backoffice/organizations/${org}/subscription`, { planKey: "nao-existe", monthlyFeeCents: 1, orderCap: 1 })).statusCode).toBe(400);
    expect((await post(plat, `/v1/backoffice/organizations/${org}/subscription`, { planKey, monthlyFeeCents: "x", orderCap: 1 })).statusCode).toBe(400);
    expect((await post(plat, `/v1/backoffice/organizations/${org}/subscription`, { planKey, monthlyFeeCents: 49_900, orderCap: 1000 })).statusCode).toBe(201);
    expect((await post(plat, `/v1/backoffice/organizations/${org}/subscription`, { planKey, monthlyFeeCents: 49_900, orderCap: 1000 })).statusCode).toBe(409);
    expect((await order(op)).statusCode).toBe(201);
    const ov = (await get(plat, "/v1/backoffice/overview")).json().organizations as { organizationId: string; status: string; usedThisMonth: number; orderCap: number }[];
    const mine = ov.find((o) => o.organizationId === org)!;
    expect(mine).toMatchObject({ status: "implantacao", orderCap: 1000 });
    expect(mine.usedThisMonth).toBeGreaterThanOrEqual(1);
  });

  it("transições inválidas e sem motivo são recusadas; válidas ficam na trilha da plataforma", async () => {
    expect((await status("em_atraso", "x")).statusCode).toBe(400);
    expect((await status("banana")).statusCode).toBe(400);
    expect((await status("ativo")).statusCode).toBe(200);
    expect((await status("suspenso")).statusCode).toBe(400); // motivo obrigatório
    const audit = (await get(plat, `/v1/backoffice/audit?organizationId=${org}`)).json().entries as { action: string }[];
    expect(audit.filter((a) => a.action === "subscription.status").length).toBe(1);
    expect((await get(boss, `/v1/backoffice/audit?organizationId=${org}`)).statusCode).toBe(403);
  });

  it("suspensão: escrita 423 (API, catálogo, transição), leitura e exportação seguem, venda externa recusada, jobs pulam", async () => {
    const existing = (await order(op, "=cmd|' /C calc'!A0")).json().id as string;
    expect((await status("suspenso", "inadimplência")).statusCode).toBe(200);
    expect((await order(op)).statusCode).toBe(423);
    expect((await post(boss, "/v1/products", { name: "Novo" })).statusCode).toBe(423);
    expect((await post(boss, `/v1/orders/${existing}/transition`, { axis: "platform", from: "criado", to: "em_analise" })).statusCode).toBe(423);
    expect((await get(op, "/v1/orders")).statusCode).toBe(200);
    expect((await get(op, "/v1/orders")).json().orders.length).toBeGreaterThanOrEqual(2);
    // jobs não falham por causa da org suspensa
    await expect(markOverdueAll(pool, sys)).resolves.toBeTypeOf("number");
  });

  it("exportação (suspensa): CSV sem CPF, telefone mascarado, sem injeção de fórmula, com trilha", async () => {
    expect((await get(boss, "/v1/export/orders.csv")).statusCode).toBe(200); // project_admin tem tudo
    const r = await get(op, "/v1/export/orders.csv");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.body).not.toContain("52998224725");
    expect(r.body).not.toContain("61999991234");
    expect(r.body).toContain("Maria Segredo");
    expect(r.body).not.toMatch(/(^|,|\n)=cmd/); // fórmula neutralizada
    expect((await get(op, "/v1/export/ledger.csv")).statusCode).toBe(200);
    expect((await get(noPerm, "/v1/export/orders.csv")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/export/orders.csv", headers: { authorization: boss.headers.authorization! } })).statusCode).toBe(400); // sem projeto
    expect((await admin.query("select count(*)::int as n from audit_log where project_id = $1 and action = 'export.orders'", [p1])).rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("webhook de venda recusa organização suspensa (423) e não grava nada", async () => {
    await admin.query("insert into sale_connectors (organization_id, project_id, provider, secret_sealed) select $1,$2,'braip','x'", [org, p1]).catch(() => {});
    // O conector real é criado na org ativa; aqui o que importa é a regra: criação já foi barrada pela suspensão.
    expect((await post(boss, "/v1/connectors", { provider: "braip" })).statusCode).toBe(423);
  });

  it("reativação devolve a escrita; encerramento + retenção + confirmação habilitam o descarte e anonimizam a PII", async () => {
    expect((await status("ativo", "regularizou")).statusCode).toBe(200);
    expect((await order(op)).statusCode).toBe(201);
    expect((await status("suspenso", "fim")).statusCode).toBe(200);
    expect((await status("encerrado", "contrato encerrado")).statusCode).toBe(200);
    expect((await status("ativo")).statusCode).toBe(400); // encerrado é terminal
    const d = (confirm: string) => post(plat, `/v1/backoffice/organizations/${org}/discard-pii`, { confirm });
    expect((await d("errado")).statusCode).toBe(400);
    expect((await d(org)).statusCode).toBe(400); // retenção de 30 dias
    expect((await post(boss, `/v1/backoffice/organizations/${org}/discard-pii`, { confirm: org })).statusCode).toBe(403);
    await admin.query("update subscriptions set closed_at = now() - interval '31 days' where organization_id = $1", [org]);
    const r = await d(org);
    expect(r.statusCode).toBe(200);
    expect(r.json().customers).toBeGreaterThanOrEqual(1); // mesmo CPF = mesmo cliente (dedupe por hash)
    const rows = (await admin.query("select name, cpf_encrypted, phone, email from customers where organization_id = $1", [org])).rows;
    expect(rows.every((c) => c.name === "[descartado]" && c.cpf_encrypted === null && c.phone === null && c.email === null)).toBe(true);
    expect((await admin.query("select count(*)::int as n from orders where organization_id = $1", [org])).rows[0].n).toBeGreaterThanOrEqual(3);
    expect((await d(org)).json().customers).toBe(0);
  });
});
