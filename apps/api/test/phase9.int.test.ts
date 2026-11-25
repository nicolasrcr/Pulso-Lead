import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";
import { uniq } from "./helpers";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;
const PASSWORD = "senha-de-teste-123";
const KEY = "5".repeat(64);
let n = 0;

run("API — Fase 9: paginação de pedidos", () => {
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof buildApp>;
  let org: string, p1: string, p2: string;
  interface H { headers: Record<string, string> }
  let boss: H, boss2: H, op: H;
  async function user(project: string, role: string, caps: string[]): Promise<H> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [reg.json().id, org, project, role, caps]);
    return { headers: { authorization: `Bearer ${token}`, "x-project-id": project } };
  }
  const post = (h: H, url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: h.headers, payload: payload as object });
  const get = (h: H, url: string) => app.inject({ method: "GET", url, headers: h.headers });

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN }); pool = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool, cpfKey: KEY });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    org = (await admin.query("insert into organizations (name, slug) values ('o9',$1) returning id", [`o9-${Date.now()}`])).rows[0].id;
    const mp = async (nm: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,$2,'pos-pago',1) returning id", [org, nm])).rows[0].id as string;
    p1 = await mp("E1"); p2 = await mp("E2");
    boss = await user(p1, "project_admin", []); boss2 = await user(p2, "project_admin", []);
    op = await user(p1, "operator", PRESETS.mentorado_atendente!);
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  async function mkOrders(h: H, n: number, planOwner: H = h): Promise<string[]> {
    const prod = (await post(planOwner, "/v1/products", { name: "P" })).json().id as string;
    const plan = (await post(planOwner, `/v1/products/${prod}/plans`, { name: "Pl", priceCents: 10000, commissionRule: { type: "percent", bps: 1000 }, bom: [] })).json().id as string;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await post(h, "/v1/orders", { planId: plan, customer: { name: `C${i}`, phone: "61999990000", address: { zip: "70000000", uf: "DF", city: "Brasilia", street: "R", number: "1" } } })).json().id);
    return ids;
  }
  it("sem parâmetros mantém o contrato (até 200, mais novo primeiro) e informa nextCursor nulo", async () => {
    await mkOrders(boss, 3);
    const r = (await get(boss, "/v1/orders")).json();
    expect(r.orders.length).toBe(3);
    expect(r.nextCursor).toBeNull();
    const dates = r.orders.map((o: { createdAt: string }) => o.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
  it("pagina por cursor sem repetir nem perder pedidos", async () => {
    await mkOrders(boss2, 5);
    const seen: string[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const r: { orders: { id: string }[]; nextCursor: string | null } = (await get(boss2, `/v1/orders?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json();
      expect(r.orders.length).toBeLessThanOrEqual(2);
      seen.push(...r.orders.map((o: { id: string }) => o.id)); cursor = r.nextCursor; pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen.length).toBe(5);
    expect(new Set(seen).size).toBe(5);
  });
  it("valida limit e cursor", async () => {
    expect((await get(boss, "/v1/orders?limit=0")).statusCode).toBe(400);
    expect((await get(boss, "/v1/orders?limit=abc")).statusCode).toBe(400);
    expect((await get(boss, "/v1/orders?limit=201")).statusCode).toBe(400);
    expect((await get(boss, "/v1/orders?cursor=lixo")).statusCode).toBe(400);
  });
  it("quem só vê os próprios pedidos continua restrito ao paginar", async () => {
    const boss1Orders = await mkOrders(boss, 2);
    const own = await user(p1, "operator", ["orders.create"]);
    const mine = await mkOrders(own, 2, boss);
    expect(mine.every(Boolean)).toBe(true);
    const seen: string[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const r: { orders: { id: string }[]; nextCursor: string | null } = (await get(own, `/v1/orders?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json();
      seen.push(...r.orders.map((o) => o.id)); cursor = r.nextCursor; pages++;
    } while (cursor && pages < 10);
    expect(seen.sort()).toEqual([...mine].sort());
    for (const id of boss1Orders) expect(seen).not.toContain(id);
  });
});
