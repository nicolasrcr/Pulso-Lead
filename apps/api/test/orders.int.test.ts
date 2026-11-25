import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";
import { tx } from "../src/db";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;

const PASSWORD = "senha-de-teste-123";
const CPF = "52998224725";
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}@t.test`;

run("API — catálogo, estoque e pedidos (Postgres real, papel app_user)", () => {
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof buildApp>;
  let orgA: string, orgB: string, a1: string, a2: string, b1: string;
  let boss: H, op1: H, op1b: H, op2: H, opB: H, cobr: H, nocap: H;
  let planA1: string, planA1x3: string, planA2: string, caixa: string, frasco: string;

  interface H { id: string; headers: Record<string, string> }
  async function user(project: string | null, org: string, role: string, caps: string[], scope: string | null = project): Promise<H> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [reg.json().id, org, scope, role, caps]);
    return { id: reg.json().id, headers: { authorization: `Bearer ${token}`, ...(project ? { "x-project-id": project } : {}) } };
  }
  const post = (h: H, url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: h.headers, payload: payload as object });
  const get = (h: H, url: string) => app.inject({ method: "GET", url, headers: h.headers });
  const order = (h: H, plan: string, extra: object = {}) =>
    post(h, "/v1/orders", { planId: plan, customer: { name: "Maria", cpf: CPF, phone: "(61) 99999-1234" }, ...extra });

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN });
    pool = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool, cpfKey: "d".repeat(64) });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    const mkOrg = async (name: string) => (await admin.query("insert into organizations (name, slug) values ($1,$2) returning id", [name, `${name}-${Date.now()}-${n++}`])).rows[0].id as string;
    const mkProj = async (org: string, name: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,$2,'pos-pago',1) returning id", [org, name])).rows[0].id as string;
    orgA = await mkOrg("oa"); orgB = await mkOrg("ob");
    a1 = await mkProj(orgA, "A1"); a2 = await mkProj(orgA, "A2"); b1 = await mkProj(orgB, "B1");
    await admin.query("insert into plans (key, name) values ('int-test','Teste') on conflict do nothing");
    await admin.query("insert into subscriptions (organization_id, plan_id, status, order_cap) values ($1, (select id from plans where key='int-test'), 'ativo', 1000)", [orgA]);

    boss = await user(a1, orgA, "project_admin", []);
    op1 = await user(a1, orgA, "operator", PRESETS.mentorado_atendente!);
    op1b = await user(a1, orgA, "operator", PRESETS.mentorado_atendente!);
    op2 = await user(a2, orgA, "operator", PRESETS.mentorado_atendente!);
    opB = await user(b1, orgB, "operator", PRESETS.mentorado_atendente!);
    cobr = await user(a1, orgA, "operator", PRESETS.cobranca_master!);
    nocap = await user(a1, orgA, "operator", []);

    const item = async (sku: string, quantity: number) => (await post(boss, "/v1/stock-items", { sku, name: sku, quantity })).json().id as string;
    caixa = await item("CAIXA", 10); frasco = await item("FRASCO", 2);
    const prod = (await post(boss, "/v1/products", { name: "Produto" })).json().id as string;
    const plan = async (name: string, bom: object[]) => (await post(boss, `/v1/products/${prod}/plans`, { name, priceCents: 19900, bom })).json().id as string;
    planA1 = await plan("P1", [{ stockItemId: caixa, qty: 1 }, { stockItemId: frasco, qty: 1 }]);
    planA1x3 = await plan("P3", [{ stockItemId: caixa, qty: 1 }, { stockItemId: frasco, qty: 3 }]);
    const boss2 = await user(a2, orgA, "project_admin", []);
    const prod2 = (await post(boss2, "/v1/products", { name: "Produto A2" })).json().id as string;
    planA2 = (await post(boss2, `/v1/products/${prod2}/plans`, { name: "P-A2", priceCents: 1000, bom: [] })).json().id as string;
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  it("catálogo: exige products.manage e projeto; BOM só com itens do próprio projeto", async () => {
    expect((await post(op1, "/v1/products", { name: "X" })).statusCode).toBe(403);
    expect((await post({ ...boss, headers: { authorization: boss.headers.authorization! } }, "/v1/products", { name: "X" })).statusCode).toBe(400);
    const prod = (await post(boss, "/v1/products", { name: "Y" })).json().id;
    const foreign = (await post(boss, `/v1/products/${prod}/plans`, { name: "ruim", priceCents: 1, bom: [{ stockItemId: "00000000-0000-0000-0000-000000000000", qty: 1 }] }));
    expect(foreign.statusCode).toBe(400);
    expect((await post(boss, `/v1/products/${prod}/plans`, { name: "neg", priceCents: -1 })).statusCode).toBe(400);
  });

  it("cria pedido: CPF nunca em claro; detalhe mascarado; estado inicial dos 3 eixos", async () => {
    const r = await order(op1, planA1);
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    const stored = await tx(pool, { userId: boss.id, projectId: a1 }, async (c) =>
      (await c.query("select c.cpf_encrypted, c.cpf_hash from customers c join orders o on o.customer_id = c.id where o.id = $1", [id])).rows[0] as { cpf_encrypted: Buffer; cpf_hash: string });
    expect(stored.cpf_encrypted.toString("latin1")).not.toContain(CPF);
    expect(stored.cpf_hash).toMatch(/^[0-9a-f]{64}$/);
    const d = (await get(op1, `/v1/orders/${id}`)).json();
    expect(d.cpf).toBe("***.***.***-25");
    expect(d.phone).toBe("(61) *****-**34");
    expect(JSON.stringify(d)).not.toContain(CPF);
    expect([d.platform, d.shipping, d.payment]).toEqual(["criado", "sem_status", "sem_status"]);
  });

  it("valida entrada: CPF inválido, plano de outro projeto, total negativo", async () => {
    expect((await post(op1, "/v1/orders", { planId: planA1, customer: { name: "M", cpf: "11111111111" } })).statusCode).toBe(400);
    expect((await order(op1, planA2)).statusCode).toBe(400);
    expect((await order(op1, planA1, { totalCents: -5 })).statusCode).toBe(400);
    expect((await post(op1, "/v1/orders", { planId: planA1, customer: {} })).statusCode).toBe(400);
  });

  it("idempotência por externalId: reenvio não duplica nem recontabiliza", async () => {
    const before = (await get(boss, "/v1/volume")).json().used as number;
    const a = await order(op1, planA1, { externalId: "ext-API-1" });
    const b = await order(op1, planA1, { externalId: "ext-API-1" });
    expect(a.statusCode).toBe(201); expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect((await get(boss, "/v1/volume")).json().used).toBe(before + 1);
  });

  it("isolamento: outro projeto/organização não vê nem cria; header de projeto alheio = 403", async () => {
    const id = (await order(op1, planA1)).json().id as string;
    expect((await get(op2, `/v1/orders/${id}`)).statusCode).toBe(404);
    expect((await get(opB, `/v1/orders/${id}`)).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/orders", headers: { ...op1.headers, "x-project-id": a2 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/orders", headers: { ...opB.headers, "x-project-id": a1 }, payload: { planId: planA1, customer: { name: "x" } } })).statusCode).toBe(403);
    expect((await post(opB, "/v1/orders", { planId: planA1, customer: { name: "x" } })).statusCode).toBe(400); // plano inexistente no projeto de B
  });

  it("visibilidade: sem orders.read_all só os próprios; com read_all, o projeto todo", async () => {
    const mine = (await order(op1, planA1, { externalId: `vis-${n++}` })).json().id as string;
    const list1 = (await get(op1, "/v1/orders")).json().orders as { id: string }[];
    const list1b = (await get(op1b, "/v1/orders")).json().orders as { id: string }[];
    expect(list1.some((o) => o.id === mine)).toBe(true);
    expect(list1b.some((o) => o.id === mine)).toBe(false);
    expect((await get(op1b, `/v1/orders/${mine}`)).statusCode).toBe(404);
    expect(((await get(cobr, "/v1/orders")).json().orders as { id: string }[]).some((o) => o.id === mine)).toBe(true);
    expect((await get(nocap, "/v1/orders")).statusCode).toBe(403);
    expect((await post(nocap, "/v1/orders", { planId: planA1, customer: { name: "x" } })).statusCode).toBe(403);
  });

  it("reveal-cpf: exige orders.edit e grava audit_log", async () => {
    const id = (await order(op1, planA1)).json().id as string;
    expect((await post(op1, `/v1/orders/${id}/reveal-cpf`)).statusCode).toBe(403);
    const r = await post(boss, `/v1/orders/${id}/reveal-cpf`);
    expect(r.statusCode).toBe(200); expect(r.json().cpf).toBe(CPF);
    const log = await tx(pool, { userId: boss.id, projectId: a1 }, async (c) =>
      (await c.query("select actor_id, action from audit_log where entity_id = $1", [id])).rows);
    expect(log).toEqual([{ actor_id: boss.id, action: "cpf.reveal" }]);
  });

  it("liberação: baixa única mesmo com chamadas concorrentes; sem estoque = 409 e nada baixado", async () => {
    const id = (await order(op1, planA1)).json().id as string;
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(boss, `/v1/orders/${id}/release`)));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(rs.filter((r) => r.json().released).length).toBe(1);
    const items = (await get(boss, "/v1/stock-items")).json().items as { sku: string; quantity: number }[];
    const q = (s: string) => items.find((i) => i.sku === s)!.quantity;
    expect([q("CAIXA"), q("FRASCO")]).toEqual([9, 1]);
    const big = (await order(op1, planA1x3)).json().id as string;
    expect((await post(boss, `/v1/orders/${big}/release`)).statusCode).toBe(409);
    const after = (await get(boss, "/v1/stock-items")).json().items as { sku: string; quantity: number }[];
    expect(after.find((i) => i.sku === "CAIXA")!.quantity).toBe(9);
    expect((await post(op1, `/v1/orders/${id}/release`)).statusCode).toBe(403);
  });

  it("transição: valida pelo template, capability por eixo e compare-and-swap", async () => {
    const id = (await order(op1, planA1)).json().id as string;
    const t = (body: object, h = cobr) => post(h, `/v1/orders/${id}/transition`, body);
    expect((await t({ axis: "payment", from: "sem_status", to: "pendente" })).statusCode).toBe(200);
    expect((await t({ axis: "payment", from: "sem_status", to: "pago" })).statusCode).toBe(400); // não existe no template
    expect((await t({ axis: "payment", from: "pendente", to: "inexistente" })).statusCode).toBe(400);
    expect((await t({ axis: "shipping", from: "sem_status", to: "entregue" })).statusCode).toBe(400); // envio é da transportadora
    expect((await t({ axis: "payment", from: "pendente", to: "pago" }, op1)).statusCode).toBe(403); // entrega ainda não ocorreu
    expect((await t({ axis: "payment", from: "pendente", to: "pago" })).statusCode).toBe(200);
    expect((await t({ axis: "payment", from: "pendente", to: "pago" })).statusCode).toBe(409); // replay com estado desatualizado (CAS)
    const d = (await get(cobr, `/v1/orders/${id}`)).json();
    expect(d.payment).toBe("pago"); expect(d.paidAt).toBeTruthy();
    expect((d.events as { axis: string }[]).filter((e) => e.axis === "payment").length).toBe(2);
  });

  it("kanban e volume refletem os pedidos visíveis", async () => {
    const k = (await get(cobr, "/v1/kanban")).json().buckets as { key: string; count: number }[];
    expect(k.length).toBeGreaterThan(0);
    expect(k.reduce((s, b) => s + b.count, 0)).toBeGreaterThan(0);
    const v = (await get(boss, "/v1/volume")).json();
    expect(v.cap).toBe(1000); expect(v.used).toBeGreaterThan(0); expect(v.over).toBe(false);
    const vb = (await get(opB, "/v1/volume")).json();
    expect([vb.used, vb.cap]).toEqual([0, 0]); // vê só a própria organização, nunca o contador da A
  });
});
