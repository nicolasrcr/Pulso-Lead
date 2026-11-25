import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";
import { tx } from "../src/db";
import { uniq } from "./helpers";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;

const PASSWORD = "senha-de-teste-123";
let n = 0;

run("API — afiliados, comissão, devoluções e inadimplência (Postgres real, papel app_user)", () => {
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof buildApp>;
  let orgA: string, a1: string, a2: string;
  interface H { id: string; headers: Record<string, string> }
  let boss: H, boss2: H, op: H, cobr: H;
  let aff: string, affOther: string, plan: string, caixa: string;

  async function user(project: string, role: string, caps: string[]): Promise<H> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [reg.json().id, orgA, project, role, caps]);
    return { id: reg.json().id, headers: { authorization: `Bearer ${token}`, "x-project-id": project } };
  }
  const post = (h: H, url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: h.headers, payload: payload as object });
  const get = (h: H, url: string) => app.inject({ method: "GET", url, headers: h.headers });
  const stock = async () => ((await get(boss, "/v1/stock-items")).json().items as { sku: string; quantity: number }[]).find((i) => i.sku === "CX")!.quantity;
  const newOrder = async (extra: object = {}) =>
    (await post(op, "/v1/orders", { planId: plan, affiliateId: aff, customer: { name: "Cliente" }, ...extra })).json().id as string;
  const pay = async (id: string) => {
    expect((await post(cobr, `/v1/orders/${id}/transition`, { axis: "platform", from: "criado", to: "cobrado" })).statusCode).toBe(200);
    expect((await post(cobr, `/v1/orders/${id}/transition`, { axis: "payment", from: "sem_status", to: "pendente" })).statusCode).toBe(200);
    expect((await post(cobr, `/v1/orders/${id}/transition`, { axis: "payment", from: "pendente", to: "pago" })).statusCode).toBe(200);
  };
  const balance = async () => ((await get(boss, "/v1/commissions")).json().affiliates as { affiliateId: string; balanceCents: number; accruedCents: number; reversedCents: number }[]).find((a) => a.affiliateId === aff)!;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN });
    pool = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool, cpfKey: "e".repeat(64) });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    orgA = (await admin.query("insert into organizations (name, slug) values ('oc',$1) returning id", [`oc-${Date.now()}`])).rows[0].id;
    const mp = async (name: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version, settings) values ($1,$2,'pos-pago',1,'{\"overdue_grace_days\": 5}') returning id", [orgA, name])).rows[0].id as string;
    a1 = await mp("C1"); a2 = await mp("C2");
    boss = await user(a1, "project_admin", []); boss2 = await user(a2, "project_admin", []);
    op = await user(a1, "operator", PRESETS.mentorado_atendente!);
    cobr = await user(a1, "operator", PRESETS.cobranca_master!);
    aff = (await post(boss, "/v1/affiliates", { name: "Afiliada" })).json().id;
    affOther = (await post(boss2, "/v1/affiliates", { name: "Outra" })).json().id;
    caixa = (await post(boss, "/v1/stock-items", { sku: "CX", name: "Caixa", quantity: 10 })).json().id;
    const prod = (await post(boss, "/v1/products", { name: "P" })).json().id;
    plan = (await post(boss, `/v1/products/${prod}/plans`, { name: "Pl", priceCents: 19900, commissionRule: { type: "percent", bps: 1000 }, bom: [{ stockItemId: caixa, qty: 2 }] })).json().id;
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  it("afiliados: criar exige users.manage; lista não expõe link_secret", async () => {
    expect((await post(op, "/v1/affiliates", { name: "X" })).statusCode).toBe(403);
    expect((await post(boss, "/v1/affiliates", { name: "" })).statusCode).toBe(400);
    const list = (await get(boss, "/v1/affiliates")).json();
    expect(JSON.stringify(list)).not.toContain("link_secret");
    expect((list.affiliates as { id: string }[]).some((a) => a.id === affOther)).toBe(false); // outro projeto
  });

  it("regra de comissão do plano é validada", async () => {
    const prod = (await post(boss, "/v1/products", { name: "Q" })).json().id;
    for (const bad of [{ type: "percent", bps: 10001 }, { type: "percent", bps: -1 }, { type: "fixed", cents: 1.5 }, { type: "outro" }, "x"]) {
      expect((await post(boss, `/v1/products/${prod}/plans`, { name: "r", priceCents: 1, commissionRule: bad })).statusCode).toBe(400);
    }
    expect((await post(boss, `/v1/products/${prod}/plans`, { name: "ok", priceCents: 1, commissionRule: { type: "fixed", cents: 50 } })).statusCode).toBe(201);
  });

  it("pedido recusa afiliado de outro projeto", async () => {
    const r = await post(op, "/v1/orders", { planId: plan, affiliateId: affOther, customer: { name: "C" } });
    expect(r.statusCode).toBe(400);
  });

  it("pagamento credita a comissão uma vez; devolução repõe estoque e estorna", async () => {
    const before = await stock();
    const id = await newOrder();
    expect((await post(boss, `/v1/orders/${id}/release`)).json().released).toBe(true);
    expect(await stock()).toBe(before - 2);
    const b0 = await balance();
    await pay(id);
    const b1 = await balance();
    expect(b1.accruedCents - b0.accruedCents).toBe(1990);
    expect((await post(op, `/v1/orders/${id}/return`, { disposition: "returned" })).statusCode).toBe(403);
    const r = await post(boss, `/v1/orders/${id}/return`, { disposition: "returned", reason: "desistiu" });
    expect(r.statusCode).toBe(200);
    expect(await stock()).toBe(before);
    const b2 = await balance();
    expect(b2.balanceCents).toBe(b0.balanceCents);
    expect(b2.reversedCents - b0.reversedCents).toBe(-1990);
    expect((await post(boss, `/v1/orders/${id}/return`, { disposition: "returned" })).statusCode).toBe(409);
    expect((await get(boss, `/v1/orders/${id}`)).json().platform).toBe("devolucao_concluida");
  });

  it("devolução descartada não repõe estoque; disposição e estado inválidos são recusados", async () => {
    const id = await newOrder();
    await post(boss, `/v1/orders/${id}/release`);
    const mid = await stock();
    expect((await post(boss, `/v1/orders/${id}/return`, { disposition: "returned" })).statusCode).toBe(409); // ainda 'criado'
    await pay(id);
    expect((await post(boss, `/v1/orders/${id}/return`, { disposition: "xyz" })).statusCode).toBe(400);
    expect((await post(boss, `/v1/orders/${id}/return`, { disposition: "discarded", reason: "avariado" })).statusCode).toBe(200);
    expect(await stock()).toBe(mid);
  });

  it("outro projeto não devolve nem enxerga o pedido", async () => {
    const id = await newOrder();
    expect((await post(boss2, `/v1/orders/${id}/return`, { disposition: "returned" })).statusCode).toBe(404);
  });

  it("inadimplência: só entregues, cobrados e não pagos além do prazo do projeto; exige orders.status.all", async () => {
    const late = await newOrder(); const fresh = await newOrder();
    for (const id of [late, fresh]) await post(cobr, `/v1/orders/${id}/transition`, { axis: "platform", from: "criado", to: "cobrado" });
    const deliver = (id: string, at: string) => tx(pool, { userId: boss.id, projectId: a1 }, (c) => c.query("select app.transition_order($1,'shipping','sem_status','entregue',$2,null)", [id, at]));
    await deliver(late, "2026-01-01T12:00:00Z");
    await deliver(fresh, new Date().toISOString());
    expect((await post(op, "/v1/overdue/run")).statusCode).toBe(403);
    expect((await post(cobr, "/v1/overdue/run")).json().marked).toBe(1);
    expect((await get(boss, `/v1/orders/${late}`)).json().platform).toBe("inadimplente");
    expect((await get(boss, `/v1/orders/${fresh}`)).json().platform).toBe("cobrado");
    expect((await post(cobr, "/v1/overdue/run")).json().marked).toBe(0);
  });

  it("ledger é imutável para a aplicação", async () => {
    await expect(tx(pool, { userId: boss.id, projectId: a1 }, (c) => c.query("update commission_ledger set amount_cents = 1"))).rejects.toMatchObject({ code: "42501" });
  });
});
