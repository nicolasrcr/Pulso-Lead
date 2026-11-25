import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";
import type { JtTransport } from "@pulso/carriers";
import { makeSecretBox } from "../src/webhooks/secret-box";
import { makeCarrierFactory } from "../src/carriers";
import { syncTrackingAll, pathTo } from "../src/tracking/sync";
import { dispatchDue } from "../src/webhooks/dispatcher";
import { tx } from "../src/db";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;
const PASSWORD = "senha-de-teste-123";
const KEY = "7".repeat(64);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}@t.test`;

run("API — Fase 3: conectores de venda, transportadora J&T (mock), rastreio", () => {
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof buildApp>;
  let org: string, p1: string, p2: string, sys: string;
  interface H { id: string; headers: Record<string, string> }
  let boss: H, op: H, boss2: H;
  let plan: string, aff: string;
  let scans: { scanType: string; scanTime: string }[] = [];
  let jtCalls: string[] = [];
  // Horário de Brasília (-03:00), "YYYY-MM-DD HH:MM:SS", h horas à frente de agora (eventos reais sempre vêm após a etiqueta).
  const at = (h: number) => new Date(Date.now() + h * 3_600_000 - 3 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
  const transport: JtTransport = async (req) => {
    jtCalls.push(req.url);
    if (req.url.endsWith("/addOrder")) return { status: 200, json: { code: "1", data: { orderList: [{ billCode: `JTB${Date.now()}${n++}` }] } } };
    if (req.url.endsWith("/logistics/trace")) return { status: 200, json: { code: "1", data: [{ details: scans }] } };
    return { status: 200, json: { code: "1" } };
  };
  const box = makeSecretBox(KEY, "integration:secret");

  async function user(project: string, role: string, caps: string[], platformAdmin = false): Promise<H> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [reg.json().id, org, project, role, caps]);
    if (platformAdmin) await admin.query("update app_users set platform_admin = true where id = $1", [reg.json().id]);
    return { id: reg.json().id, headers: { authorization: `Bearer ${token}`, "x-project-id": project } };
  }
  const post = (h: H, url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: h.headers, payload: payload as object });
  const get = (h: H, url: string) => app.inject({ method: "GET", url, headers: h.headers });
  const hook = (id: string, secret: string, body: object) => app.inject({ method: "POST", url: `/v1/hooks/sales/${id}`, headers: { "x-webhook-token": secret }, payload: body });
  const status = async (id: string) => (await admin.query("select platform_status, payment_status, shipping_status from order_status where order_id = $1", [id])).rows[0];

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN });
    pool = new pg.Pool({ connectionString: APP });
    sys = "";
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    org = (await admin.query("insert into organizations (name, slug) values ('o3',$1) returning id", [`o3-${Date.now()}`])).rows[0].id;
    const mp = async (nm: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,$2,'pos-pago',1) returning id", [org, nm])).rows[0].id as string;
    p1 = await mp("S1"); p2 = await mp("S2");
    // usuário de sistema precisa existir antes do app (SYSTEM_USER_ID)
    const bootstrap = buildApp({ pool, cpfKey: KEY });
    const reg = await bootstrap.inject({ method: "POST", url: "/v1/auth/register", payload: { email: uniq("sys"), name: "Sys", password: PASSWORD } });
    sys = reg.json().id;
    await admin.query("update app_users set platform_admin = true where id = $1", [sys]);
    await bootstrap.close();
    app = buildApp({ pool, cpfKey: KEY, systemUserId: sys, carriers: makeCarrierFactory(box, { labelBaseUrl: "https://app.exemplo.com/labels", transport }) });
    boss = await user(p1, "project_admin", []); boss2 = await user(p2, "project_admin", []);
    op = await user(p1, "operator", PRESETS.mentorado_atendente!);
    const prod = (await post(boss, "/v1/products", { name: "P" })).json().id;
    plan = (await post(boss, `/v1/products/${prod}/plans`, { name: "Pl", priceCents: 19790 })).json().id;
    aff = (await post(boss, "/v1/affiliates", { name: "Af" })).json().id;
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  describe("conectores de venda", () => {
    let conn: { id: string; secret: string };
    const sale = (key: string, st = "Aguardando pagamento", extra: object = {}) => ({ trans_key: key, prod_key: "PROD-EXT", client_name: "Ana Sigilosa", client_email: "ana@x.com", client_cel: "(61) 99999-1234", trans_value: 197.9, trans_status: st, aff_email: "af@x.com", ...extra });
    it("só quem tem users.manage cria conector; segredo aparece uma vez", async () => {
      expect((await post(op, "/v1/connectors", { provider: "braip" })).statusCode).toBe(403);
      expect((await post(boss, "/v1/connectors", { provider: "nao-existe" })).statusCode).toBe(400);
      const r = await post(boss, "/v1/connectors", { provider: "braip" });
      expect(r.statusCode).toBe(201);
      conn = r.json();
      expect(conn.secret).toMatch(/^conn_[0-9a-f]{48}$/);
      expect((await get(boss, "/v1/connectors")).body).not.toContain("conn_");
      expect((await admin.query("select secret_sealed from sale_connectors where id = $1", [conn.id])).rows[0].secret_sealed).not.toContain("conn_");
    });
    it("segredo errado = 401 e nada é gravado; conector inexistente = 404", async () => {
      expect((await hook(conn.id, "errado", sale("T0"))).statusCode).toBe(401);
      expect((await admin.query("select count(*)::int as n from webhook_events_raw where project_id = $1", [p1])).rows[0].n).toBe(0);
      expect((await hook("00000000-0000-0000-0000-000000000000", conn.secret, sale("T0"))).statusCode).toBe(404);
    });
    it("produto sem vínculo → unlinked (nenhum pedido criado); depois do vínculo, reprocessa e cria", async () => {
      const r = await hook(conn.id, conn.secret, sale("T1"));
      expect(r.json()).toMatchObject({ duplicate: false, status: "unlinked" });
      expect((await admin.query(`select count(*)::int as n from orders where external_id = 'T1' and project_id = '${p1}'`)).rows[0].n).toBe(0);
      expect((await post(op, "/v1/product-links", { provider: "braip", externalProductId: "PROD-EXT", planId: plan })).statusCode).toBe(403);
      expect((await post(boss, "/v1/product-links", { provider: "braip", externalProductId: "PROD-EXT", planId: "00000000-0000-0000-0000-0000000000aa" })).statusCode).toBe(400);
      expect((await post(boss, "/v1/product-links", { provider: "braip", externalProductId: "PROD-EXT", planId: plan })).statusCode).toBe(201);
      expect((await post(boss, "/v1/affiliate-email-links", { provider: "braip", email: "AF@x.com", affiliateId: aff })).statusCode).toBe(201);
      const rp = await post(boss, "/v1/sales-events/reprocess");
      expect(rp.json().outcomes.processed).toBe(1);
      const o = (await admin.query(`select id, total_cents, affiliate_id from orders where external_id = 'T1' and project_id = '${p1}'`)).rows[0];
      expect(o.total_cents).toBe(19790);
      expect(o.affiliate_id).toBe(aff);
      expect(await status(o.id)).toMatchObject({ payment_status: "sem_status", platform_status: "criado" });
    });
    it("reenvio do mesmo evento é duplicata (não cria 2º pedido)", async () => {
      const r = await hook(conn.id, conn.secret, sale("T1"));
      expect(r.json()).toMatchObject({ duplicate: true });
      expect((await admin.query(`select count(*)::int as n from orders where external_id = 'T1' and project_id = '${p1}'`)).rows[0].n).toBe(1);
    });
    it("evento de pagamento aprovado: sem_status→pendente→pago e comissão lançada uma vez", async () => {
      const a = await hook(conn.id, conn.secret, sale("T1", "Pagamento Aprovado"));
      expect(a.json().status).toBe("processed");
      const o = (await admin.query(`select id from orders where external_id = 'T1' and project_id = '${p1}'`)).rows[0].id;
      expect((await status(o)).payment_status).toBe("pago");
      expect((await hook(conn.id, conn.secret, sale("T1", "Pagamento Aprovado"))).json().duplicate).toBe(true);
      expect((await admin.query("select count(*)::int as n from order_events where order_id = $1 and axis = 'payment' and to_value = 'pago'", [o])).rows[0].n).toBe(1);
    });
    it("cancelamento antes de qualquer ação: pedido vai para cancelado_sem_custo", async () => {
      await hook(conn.id, conn.secret, sale("T2"));
      const c = await hook(conn.id, conn.secret, sale("T2", "Cancelada"));
      expect(c.json().status).toBe("processed");
      const o = (await admin.query(`select id from orders where external_id = 'T2' and project_id = '${p1}'`)).rows[0].id;
      expect((await status(o)).platform_status).toBe("cancelado_sem_custo");
    });
    it("payload ilegível vira 'failed' (guardado cru, sem pedido)", async () => {
      const r = await hook(conn.id, conn.secret, { lixo: true });
      expect(r.json().status).toBe("failed");
    });
    it("isolamento: conector/vínculos de um projeto não aparecem em outro; afiliado de outro projeto é recusado", async () => {
      expect((await get(boss2, "/v1/connectors")).json().connectors).toEqual([]);
      expect((await post(boss2, "/v1/affiliate-email-links", { provider: "braip", email: "x@x.com", affiliateId: aff })).statusCode).toBe(400);
      expect((await get(boss2, "/v1/sales-events")).json().events).toEqual([]);
    });
  });

  describe("transportadora J&T (transporte mockado) e rastreio", () => {
    const creds = { customerCode: "CC", password: "SENHA-SECRETA", apiAccount: "AA", privateKey: "CHAVE-PRIVADA", env: "homolog",
      sender: { name: "R", company: "E", postCode: "70000000", taxNumber: "62333509000103", phone: "61999999999", prov: "DF", city: "BRASILIA", area: "ASA SUL", street: "RUA X", streetNumber: "1" } };
    const body = { parcel: { weightGrams: 800, lengthCm: 20, widthCm: 15, heightCm: 10 }, invoice: { number: "1", series: "1", accessKey: "0".repeat(44), issuedAt: "2026-11-01 10:00:00", issuerTaxId: "62333509000103" } };
    let orderId: string;
    const mkOrder = async () => (await post(op, "/v1/orders", { planId: plan, customer: { name: "Cliente", cpf: "52998224725", phone: "61999991234", address: { zip: "01001-000", uf: "SP", city: "SAO PAULO", street: "PRACA SE", number: "1", district: "SE" } } })).json().id as string;

    it("credenciais seladas: nunca voltam na API nem ficam em claro no banco", async () => {
      expect((await post(op, "/v1/carriers", { carrierKey: "jt", credentials: creds })).statusCode).toBe(403);
      expect((await post(boss, "/v1/carriers", { carrierKey: "jt", credentials: { ...creds, env: "x" } })).statusCode).toBe(400);
      expect((await post(boss, "/v1/carriers", { carrierKey: "jt", credentials: { ...creds, password: "" } })).statusCode).toBe(400);
      expect((await post(boss, "/v1/carriers", { carrierKey: "jt", isDefault: true, credentials: creds })).statusCode).toBe(201);
      const list = await get(boss, "/v1/carriers");
      expect(list.body).not.toContain("SENHA-SECRETA");
      const row = (await admin.query("select credentials_ref, credentials_sealed from carrier_accounts where project_id = $1", [p1])).rows[0];
      expect(JSON.stringify(row)).not.toContain("SENHA-SECRETA");
      expect(JSON.stringify(row)).not.toContain("CHAVE-PRIVADA");
    });
    it("etiqueta: cria envio, grava rastreio, avança para aguardando_coleta; segundo envio = 409", async () => {
      orderId = await mkOrder();
      expect((await post(boss2, `/v1/orders/${orderId}/shipment`, body)).statusCode).toBe(404); // outro projeto não enxerga
      expect((await post(op, `/v1/orders/${orderId}/shipment`, { ...body, invoice: { number: "1" } })).statusCode).toBe(400);
      const r = await post(boss, `/v1/orders/${orderId}/shipment`, body);
      expect(r.statusCode).toBe(201);
      expect(r.json().trackingCode).toMatch(/^JTB/);
      expect(r.json().labelUrl).toMatch(/^https:\/\/app\.exemplo\.com\/labels\//);
      expect((await status(orderId)).shipping_status).toBe("aguardando_coleta");
      expect((await post(boss, `/v1/orders/${orderId}/shipment`, body)).statusCode).toBe(409);
    });
    it("recusa da transportadora vira 422 e não grava rastreio", async () => {
      const o = await mkOrder();
      const bad = await post(boss, `/v1/orders/${o}/shipment`, { ...body, invoice: { ...body.invoice, accessKey: "123" } });
      expect(bad.statusCode).toBe(422);
      expect((await admin.query("select tracking_code from orders where id = $1", [o])).rows[0].tracking_code).toBeNull();
    });
    it("job de rastreio aplica eventos em ordem, é idempotente e nunca regride", async () => {
      scans = [{ scanType: "Saída para entrega", scanTime: at(3) }, { scanType: "Coleta", scanTime: at(1) }];
      const deps = { systemUserId: sys, carriers: makeCarrierFactory(box, { labelBaseUrl: "https://x.test", transport }), minIntervalSec: 0 };
      await syncTrackingAll(pool, deps);
      expect((await status(orderId)).shipping_status).toBe("rota_entrega");
      const before = (await admin.query("select count(*)::int as n from order_events where order_id = $1 and axis = 'shipping'", [orderId])).rows[0].n;
      await syncTrackingAll(pool, deps);
      expect((await admin.query("select count(*)::int as n from order_events where order_id = $1 and axis = 'shipping'", [orderId])).rows[0].n).toBe(before);
      scans = [{ scanType: "Coleta", scanTime: at(1) }]; // evento velho chegando de novo
      await syncTrackingAll(pool, deps);
      expect((await status(orderId)).shipping_status).toBe("rota_entrega");
      scans = [...scans, { scanType: "Entregue", scanTime: at(5) }];
      await syncTrackingAll(pool, deps);
      const s = await status(orderId);
      expect(s.shipping_status).toBe("entregue");
      jtCalls = [];
      await syncTrackingAll(pool, deps); // terminal: não consulta mais
      expect(jtCalls).toEqual([]);
    });
    it("falha da transportadora no job registra erro no pedido e segue (não derruba o lote)", async () => {
      const o = await mkOrder();
      await post(boss, `/v1/orders/${o}/shipment`, body);
      const failing: JtTransport = async () => ({ status: 500, json: { code: "999", msg: "indisponível" } });
      const r = await syncTrackingAll(pool, { systemUserId: sys, carriers: makeCarrierFactory(box, { labelBaseUrl: "https://x.test", transport: failing }), minIntervalSec: 0 });
      expect(r.errors).toBeGreaterThanOrEqual(1);
      expect((await admin.query("select tracking_sync_error from orders where id = $1", [o])).rows[0].tracking_sync_error).toMatch(/999/);
    });
    it("pathTo cobre saltos de scan e recusa o impossível", () => {
      expect(pathTo("aguardando_coleta", "em_transito")).toEqual(["coletado", "em_transito"]);
      expect(pathTo("entregue", "em_transito")).toBeNull();
    });
    it("reenvio manual: reenfileira SHIPPING_REGISTER; entrega marca tracking_synced", async () => {
      const wh = (await post(boss, "/v1/webhooks", { name: "ERP", url: "https://erp.exemplo.com.br/h", events: ["SHIPPING_REGISTER"] })).json();
      expect(wh.id).toBeTruthy();
      expect((await post(boss, `/v1/orders/${orderId}/tracking/resend`)).statusCode).toBe(200);
      expect((await admin.query("select tracking_synced from orders where id = $1", [orderId])).rows[0].tracking_synced).toBe(false);
      const f = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
      await dispatchDue(pool, { systemUserId: sys, secretBox: makeSecretBox(KEY), fetch: f });
      expect((await admin.query("select tracking_synced, tracking_synced_at from orders where id = $1", [orderId])).rows[0]).toMatchObject({ tracking_synced: true });
      const nope = await mkOrder();
      expect((await post(boss, `/v1/orders/${nope}/tracking/resend`)).statusCode).toBe(409);
    });
  });

  describe("consulta pública de rastreio", () => {
    it("devolve status e histórico sem PII; 404 uniforme para código inválido/inexistente", async () => {
      const code = (await admin.query("select tracking_code from orders where tracking_code is not null and project_id = $1 limit 1", [p1])).rows[0].tracking_code as string;
      const r = await app.inject({ method: "GET", url: `/v1/track/${code}` });
      expect(r.statusCode).toBe(200);
      expect(r.json().carrier).toBe("Enviado via J&T Express");
      expect(r.body).not.toMatch(/Cliente|52998224725|61999991234|Sigilosa/);
      expect((await app.inject({ method: "GET", url: "/v1/track/NAOEXISTE123" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/v1/track/a%20b" })).statusCode).toBe(404);
    });
  });
});
