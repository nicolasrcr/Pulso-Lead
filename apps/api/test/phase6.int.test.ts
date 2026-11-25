import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";
import { tx } from "../src/db";
import { dispatchDue } from "../src/webhooks/dispatcher";
import { makeSecretBox } from "../src/webhooks/secret-box";
import { verifyWebhook, MAX_ATTEMPTS } from "../src/webhooks/signing";
import { refreshAllDashboards, markOverdueAll } from "../src/jobs";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;
const PASSWORD = "senha-de-teste-123";
const KEY = "9".repeat(64);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}@t.test`;

run("API — webhooks de saída, link de afiliado, rastreio, importação e jobs", () => {
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof buildApp>;
  let orgA: string, p1: string, p2: string, sys: string;
  interface H { id: string; headers: Record<string, string> }
  let boss: H, op: H, boss2: H;
  let plan: string, hook: { id: string; secret: string };
  const box = makeSecretBox(KEY);

  async function user(project: string, role: string, caps: string[], platformAdmin = false): Promise<H> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [reg.json().id, orgA, project, role, caps]);
    if (platformAdmin) await admin.query("update app_users set platform_admin = true where id = $1", [reg.json().id]);
    return { id: reg.json().id, headers: { authorization: `Bearer ${token}`, "x-project-id": project } };
  }
  const post = (h: H, url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: h.headers, payload: payload as object });
  const get = (h: H, url: string) => app.inject({ method: "GET", url, headers: h.headers });
  const patch = (h: H, url: string, payload: unknown) => app.inject({ method: "PATCH", url, headers: h.headers, payload: payload as object });
  const newOrder = async (extra: object = {}) => (await post(op, "/v1/orders", { planId: plan, customer: { name: "Cliente Sigiloso", cpf: "52998224725" }, ...extra })).json().id as string;
  const deliveries = async (status?: string) => (await get(boss, `/v1/webhooks/deliveries${status ? `?status=${status}` : ""}`)).json().deliveries as { id: string; status: string; attempts: number; event: string; lastError: string | null; webhookId: string }[];
  const makeDue = (id: string) => tx(pool, { userId: sys }, (c) => c.query("update webhook_deliveries set next_attempt_at = now() - interval '1 second' where id = $1", [id]));
  const respond = (status: number) => { const calls: { url: string; init: RequestInit }[] = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(status === 204 ? null : "ok", { status }); }) as unknown as typeof fetch; return { f, calls }; };

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN });
    pool = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool, cpfKey: KEY });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    orgA = (await admin.query("insert into organizations (name, slug) values ('o6',$1) returning id", [`o6-${Date.now()}`])).rows[0].id;
    const mp = async (nm: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,$2,'pos-pago',1) returning id", [orgA, nm])).rows[0].id as string;
    p1 = await mp("W1"); p2 = await mp("W2");
    boss = await user(p1, "project_admin", []); boss2 = await user(p2, "project_admin", []);
    op = await user(p1, "operator", PRESETS.mentorado_atendente!);
    sys = (await user(p1, "project_admin", [], true)).id;
    const prod = (await post(boss, "/v1/products", { name: "P" })).json().id;
    plan = (await post(boss, `/v1/products/${prod}/plans`, { name: "Pl", priceCents: 10000 })).json().id;
    hook = (await post(boss, "/v1/webhooks", { name: "ERP", url: "https://erp.exemplo.com.br/hook", events: ["ORDER_CREATE", "CHARGE_UPDATED", "SHIPPING_REGISTER"] })).json();
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  it("cadastro de webhook: valida URL (SSRF) e eventos, exige users.manage, segredo só na criação", async () => {
    expect((await post(op, "/v1/webhooks", { name: "x", url: "https://a.com/h", events: ["ORDER_CREATE"] })).statusCode).toBe(403);
    for (const url of ["http://a.com/h", "https://localhost/h", "https://169.254.169.254/x", "https://10.0.0.1/x", "nada"])
      expect((await post(boss, "/v1/webhooks", { name: "x", url, events: ["ORDER_CREATE"] })).statusCode).toBe(400);
    expect((await post(boss, "/v1/webhooks", { name: "x", url: "https://a.com/h", events: ["EVENTO_FALSO"] })).statusCode).toBe(400);
    expect((await post(boss, "/v1/webhooks", { name: "x", url: "https://a.com/h", events: [] })).statusCode).toBe(400);
    expect(hook.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    const list = await get(boss, "/v1/webhooks");
    expect(list.body).not.toContain("whsec_");
    expect((await admin.query("select secret from outbound_webhooks where id = $1", [hook.id]).catch(() => ({ rows: [{ secret: "" }] }))).rows[0]?.secret ?? "").not.toContain("whsec_");
    expect((await get(boss2, "/v1/webhooks")).json().webhooks).toEqual([]); // outro projeto não vê
  });

  it("entrega: evento vira fila, é enviado com HMAC verificável e sem dados pessoais", async () => {
    const id = await newOrder({ externalId: `wh-${n++}` });
    const pend = (await deliveries("pending")).filter((d) => d.event === "ORDER_CREATE");
    expect(pend.length).toBeGreaterThan(0);
    const { f, calls } = respond(200);
    const r = await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: f });
    expect(r.delivered).toBeGreaterThan(0);
    const call = calls.find((c) => String(c.init.body).includes(id))!;
    const hdrs = call.init.headers as Record<string, string>;
    expect(call.url).toBe("https://erp.exemplo.com.br/hook");
    expect(call.init.redirect).toBe("manual");
    expect(verifyWebhook(hook.secret, hdrs["x-pulso-signature"]!, String(call.init.body), Math.floor(Date.now() / 1000))).toBe(true);
    expect(String(call.init.body)).not.toMatch(/Sigiloso|52998224725|cpf/i);
    expect(JSON.parse(String(call.init.body)).data.orderId).toBe(id);
    expect((await deliveries("pending")).length).toBe(0);
  });

  it("SSRF por DNS: host que resolve para IP interno não é chamado e a entrega é reagendada", async () => {
    await newOrder({ externalId: `dns-${n++}` });
    const { f, calls } = respond(200);
    const r = await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: f, resolve: async () => ["10.0.0.9"] });
    expect(calls.length).toBe(0);
    expect(r.delivered).toBe(0);
    expect(r.retried).toBeGreaterThan(0);
    expect((await deliveries("pending"))[0]!.lastError).toMatch(/interno/);
    await admin.query("update webhook_deliveries set next_attempt_at = now() where status = 'pending'");
    const ok = respond(200);
    expect((await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: ok.f, resolve: async () => ["200.147.1.1"] })).delivered).toBeGreaterThan(0);
  });

  it("falha: reagenda com backoff, não reenvia antes da hora, esgota em MAX_ATTEMPTS e permite reenvio manual", async () => {
    await newOrder({ externalId: `fl-${n++}` });
    const bad = respond(500);
    expect((await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: bad.f })).retried).toBeGreaterThan(0);
    const d = (await deliveries("pending"))[0]!;
    expect(d.attempts).toBe(1); expect(d.lastError).toBe("HTTP 500");
    const again = respond(500);
    expect((await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: again.f })).retried).toBe(0); // ainda no backoff
    expect(again.calls.length).toBe(0);
    for (let i = 1; i < MAX_ATTEMPTS; i++) { await makeDue(d.id); await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: bad.f }); }
    const failed = (await deliveries("failed")).find((x) => x.id === d.id)!;
    expect(failed.attempts).toBe(MAX_ATTEMPTS);
    expect((await post(op, `/v1/webhooks/deliveries/${d.id}/resend`)).statusCode).toBe(403);
    expect((await post(boss, `/v1/webhooks/deliveries/${d.id}/resend`)).statusCode).toBe(200);
    expect((await deliveries("pending")).find((x) => x.id === d.id)!.attempts).toBe(0);
    const ok = respond(204);
    await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: ok.f });
    expect((await deliveries("delivered")).some((x) => x.id === d.id)).toBe(true);
  });

  it("redirecionamento não é seguido (tratado como falha); erro de rede é registrado", async () => {
    await newOrder({ externalId: `rd-${n++}` });
    await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: respond(302).f });
    expect((await deliveries("pending"))[0]!.lastError).toBe("HTTP 302");
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const d = (await deliveries("pending"))[0]!; await makeDue(d.id);
    await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: boom });
    expect((await deliveries("pending")).find((x) => x.id === d.id)!.lastError).toBe("ECONNREFUSED");
    for (const x of await deliveries("pending")) await tx(pool, { userId: sys }, (c) => c.query("update webhook_deliveries set status='failed' where id=$1", [x.id]));
  });

  it("destino interno já gravado no banco é recusado no envio; webhook inativo não recebe", async () => {
    const bad = (await post(boss, "/v1/webhooks", { name: "interno", url: "https://ok.exemplo.com/x", events: ["ORDER_CREATE"] })).json();
    await tx(pool, { userId: sys }, (c) => c.query("update outbound_webhooks set url = 'https://169.254.169.254/latest' where id = $1", [bad.id]));
    await patch(boss, `/v1/webhooks/${hook.id}`, { active: false });
    await newOrder({ externalId: `ssrf-${n++}` });
    const { f, calls } = respond(200);
    await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: f });
    expect(calls.length).toBe(0);
    expect((await deliveries("pending")).find((x) => x.webhookId === bad.id)!.lastError).toMatch(/interno/);
    expect((await patch(boss, `/v1/webhooks/${bad.id}`, { url: "http://x.com" })).statusCode).toBe(400);
    await patch(boss, `/v1/webhooks/${hook.id}`, { active: true });
    await patch(boss, `/v1/webhooks/${bad.id}`, { active: false });
    for (const x of await deliveries("pending")) await tx(pool, { userId: sys }, (c) => c.query("update webhook_deliveries set status='failed' where id=$1", [x.id]));
  });

  it("rotação de segredo: o novo assina, o antigo deixa de validar", async () => {
    const rot = (await post(boss, `/v1/webhooks/${hook.id}/rotate-secret`)).json().secret as string;
    expect(rot).not.toBe(hook.secret);
    await newOrder({ externalId: `rt-${n++}` });
    const { f, calls } = respond(200);
    await dispatchDue(pool, { systemUserId: sys, secretBox: box, fetch: f });
    const c = calls.find((x) => x.url === "https://erp.exemplo.com.br/hook")!;
    const sig = (c.init.headers as Record<string, string>)["x-pulso-signature"]!, body = String(c.init.body), now = Math.floor(Date.now() / 1000);
    expect(verifyWebhook(rot, sig, body, now)).toBe(true);
    expect(verifyWebhook(hook.secret, sig, body, now)).toBe(false);
    hook.secret = rot;
  });

  it("rastreio: valida o código e dispara SHIPPING_REGISTER", async () => {
    const id = await newOrder({ externalId: `tk-${n++}` });
    expect((await post(op, `/v1/orders/${id}/tracking`, { code: "JT123456789BR" })).statusCode).toBe(403);
    expect((await post(boss, `/v1/orders/${id}/tracking`, { code: "a b;drop" })).statusCode).toBe(400);
    expect((await post(boss, `/v1/orders/${id}/tracking`, { code: "JT123456789BR" })).statusCode).toBe(200);
    expect((await deliveries()).some((d) => d.event === "SHIPPING_REGISTER")).toBe(true);
    expect((await get(boss, `/v1/orders/${id}`)).json().events.some((e: { to: string }) => e.to === "tracking_set")).toBe(true);
  });

  it("link assinado de afiliado: gera (users.manage), resolve sem sessão, rejeita adulteração", async () => {
    const aff = (await post(boss, "/v1/affiliates", { name: "Afi" })).json().id;
    expect((await get(op, `/v1/affiliates/${aff}/link`)).statusCode).toBe(403);
    const { token } = (await get(boss, `/v1/affiliates/${aff}/link?planId=${plan}`)).json();
    const ok = await app.inject({ method: "GET", url: `/v1/links/${token}` });   // sem Authorization
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ affiliateId: aff, planId: plan, projectId: p1 });
    const bad = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect((await app.inject({ method: "GET", url: `/v1/links/${bad}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/links/qualquer-coisa" })).statusCode).toBe(404);
    expect((await get(boss2, `/v1/affiliates/${aff}/link`)).statusCode).toBe(404); // outro projeto não enxerga o afiliado
  });

  it("importação CSV: cria, não duplica, reporta erros por linha e conta no volume", async () => {
    const csv = [
      "id_externo,plano_id,cliente,cpf,telefone,uf,total,pago",
      `M-1,${plan},Ana,529.982.247-25,(61) 99999-1234,df,"199,90",sim`,
      `M-2,${plan},Bia,,,sp,,`,
      `M-1,${plan},Ana repetida,,,,,`,
      `M-3,${plan},Caio,111.111.111-11,,,,`,
      `M-4,00000000-0000-0000-0000-000000000000,Dani,,,,,`,
      `,${plan},Sem id,,,,,`,
    ].join("\n");
    const byOp = await post(op, "/v1/imports", { csv });   // operador com orders.create pode importar, mas não marcar como pago
    expect(byOp.statusCode).toBe(201);
    expect(byOp.json().errors).toContainEqual({ row: 2, error: "sem permissão para importar pedido já pago" });
    expect((await get(boss, "/v1/commissions")).statusCode).toBe(200);
    const r = await post(boss, "/v1/imports", { csv });
    expect(r.statusCode).toBe(201);
    const s = r.json();
    expect(s).toMatchObject({ total: 6, created: 0, duplicates: 3, failed: 3 }); // 2º envio: M-1, M-2 e a repetição de M-1 já existem
    const first = (await post(boss, "/v1/imports", { csv: csv.replace(/M-(\d)/g, "N-$1") })).json();
    expect(first).toMatchObject({ total: 6, created: 2, duplicates: 1, failed: 3 });
    expect(first.errors).toEqual(expect.arrayContaining([{ row: 5, error: "cpf inválido" }, { row: 6, error: "plano ou afiliado não pertence ao projeto" }, { row: 7, error: "id_externo obrigatório" }]));
    expect((await get(boss, `/v1/imports/${first.id}`)).json().status).toBe("done");
    const o = (await get(boss, "/v1/orders")).json().orders as { externalId: string; payment: string; totalCents: number }[];
    const ana = o.find((x) => x.externalId === "N-1")!;
    expect(ana).toMatchObject({ payment: "pago", totalCents: 19990 });
    expect(o.find((x) => x.externalId === "N-2")!.totalCents).toBe(10000); // sem total => preço do plano
    expect((await post(boss, "/v1/imports", { csv: "" })).statusCode).toBe(400);
    expect((await post(boss, "/v1/imports", { csv: 'a\n"aberta' })).statusCode).toBe(400);
  });

  it("limite de taxa: login e links públicos", async () => {
    const limited = buildApp({ pool, cpfKey: KEY, rateLimit: { authPerMin: 3, publicPerMin: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "x@x.co", password: "errada-123456" } })).statusCode);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const l = [];
    for (let i = 0; i < 3; i++) l.push((await limited.inject({ method: "GET", url: "/v1/links/x" })).statusCode);
    expect(l).toEqual([404, 404, 429]);
    await limited.close();
  });

  it("jobs: atualizam todos os dashboards e a inadimplência sem erro (idempotentes)", async () => {
    expect(await refreshAllDashboards(pool, sys)).toBeGreaterThanOrEqual(2);
    const m1 = await markOverdueAll(pool, sys), m2 = await markOverdueAll(pool, sys);
    expect(m1).toBeGreaterThanOrEqual(0); expect(m2).toBe(0);
    expect((await get(boss, "/v1/dashboard")).json().anyStale).toBe(false);
  });
});
