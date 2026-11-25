import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;
const PASSWORD = "senha-de-teste-123";
const KEY = "4".repeat(64);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}@t.test`;

run("API — extrato de estoque (tela de estoque)", () => {
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
    org = (await admin.query("insert into organizations (name, slug) values ('o8',$1) returning id", [`o8-${Date.now()}`])).rows[0].id;
    const mp = async (nm: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,$2,'pos-pago',1) returning id", [org, nm])).rows[0].id as string;
    p1 = await mp("E1"); p2 = await mp("E2");
    boss = await user(p1, "project_admin", []); boss2 = await user(p2, "project_admin", []);
    op = await user(p1, "operator", PRESETS.mentorado_atendente!);
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  it("lista movimentos do item, do mais novo ao mais antigo, com motivo e delta", async () => {
    const id = (await post(boss, "/v1/stock-items", { sku: "S1", name: "Item", quantity: 10, minQuantity: 2 })).json().id as string;
    await post(boss, `/v1/stock-items/${id}/adjust`, { delta: -3, reason: "loss" });
    await post(boss, `/v1/stock-items/${id}/adjust`, { delta: 5, reason: "purchase" });
    const r = await get(boss, `/v1/stock-items/${id}/movements`);
    expect(r.statusCode).toBe(200);
    expect(r.json().movements.map((m: { delta: number; reason: string }) => [m.delta, m.reason])).toEqual([[5, "purchase"], [-3, "loss"], [10, "initial"]]);
    expect(r.json().movements[0]).toHaveProperty("createdAt");
  });
  it("exige permissão, valida id e não vaza entre projetos", async () => {
    const id = (await post(boss, "/v1/stock-items", { sku: "S2", name: "Item2" })).json().id as string;
    expect((await get(op, `/v1/stock-items/${id}/movements`)).statusCode).toBe(403);
    expect((await get(boss, "/v1/stock-items/xyz/movements")).statusCode).toBe(400);
    expect((await get(boss2, `/v1/stock-items/${id}/movements`)).statusCode).toBe(404);
  });
});
