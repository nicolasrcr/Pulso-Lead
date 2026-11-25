import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { tx, UUID_RE } from "../db.ts";
import { granteeIn, need, HttpError } from "../authz.ts";
import type { SecretBox } from "../webhooks/secret-box.ts";
import type { CpfVault } from "../auth/cpf-vault.ts";
import type { CarrierFactory } from "../carriers.ts";
import { PROVIDERS, mapSale, type Provider } from "../sales/mappers.ts";
import { processSaleEvent } from "../sales/processor.ts";
import { applyCarrierEvents } from "../tracking/sync.ts";
import { audit } from "../audit.ts";

export interface ConnectorDeps { box: SecretBox; vault: CpfVault; carriers: CarrierFactory; systemUserId?: string }

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const reqStr = (v: unknown, max: number, code: string) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw new HttpError(400, code); return v.trim(); };

export function registerConnectorRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler, d: ConnectorDeps) {
  const project = (req: { projectId?: string }) => { if (!req.projectId) throw new HttpError(400, "project_required"); return req.projectId; };
  const as = (req: { userId?: string; projectId?: string }) => ({ userId: req.userId!, projectId: project(req) });

  // ---- Conectores de venda (URL própria + segredo mostrado uma única vez) ----
  app.post<{ Body: { provider?: string } }>("/v1/connectors", { preHandler: authenticate }, async (req, reply) => {
    const provider = req.body?.provider;
    if (!(PROVIDERS as readonly string[]).includes(provider ?? "")) return reply.code(400).send({ error: "invalid_provider" });
    const secret = `conn_${randomBytes(24).toString("hex")}`;
    const ctx = as(req);
    const id = await tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "users.manage");
      const cid = ((await c.query(`insert into sale_connectors (organization_id, project_id, provider, secret_sealed)
        select organization_id, id, $2, $3 from projects where id = $1 returning id`, [ctx.projectId, provider, d.box.seal(secret)])).rows[0] as { id: string }).id;
      await audit(c, ctx.userId, ctx.projectId, "connector.create", "sale_connector", cid, { provider });
      return cid;
    });
    return reply.code(201).send({ id, provider, path: `/v1/hooks/sales/${id}`, secret });
  });
  app.get("/v1/connectors", { preHandler: authenticate }, async (req) => {
    const ctx = as(req);
    return tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "users.manage");
      return { connectors: (await c.query(`select id, provider, active, created_at as "createdAt" from sale_connectors order by created_at`)).rows };
    });
  });

  // ---- Vínculos produto externo → plano e e-mail → afiliado ----
  app.post<{ Body: { provider?: string; externalProductId?: string; planId?: string } }>("/v1/product-links", { preHandler: authenticate }, async (req, reply) => {
    const b = req.body ?? {}; const ctx = as(req);
    if (!(PROVIDERS as readonly string[]).includes(b.provider ?? "")) return reply.code(400).send({ error: "invalid_provider" });
    const ext = reqStr(b.externalProductId, 200, "invalid_external_product");
    if (!b.planId || !UUID_RE.test(b.planId)) return reply.code(400).send({ error: "invalid_plan" });
    const linkId = await tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "products.manage");
      const r = await c.query(`insert into external_product_links (organization_id, project_id, provider, external_product_id, plan_id)
        select p.organization_id, p.id, $2, $3, pl.id from projects p join product_plans pl on pl.project_id = p.id and pl.id = $4 where p.id = $1
        on conflict (project_id, provider, external_product_id) do update set plan_id = excluded.plan_id returning id`, [ctx.projectId, b.provider, ext, b.planId]);
      if (!r.rows.length) throw new HttpError(400, "invalid_plan");
      return (r.rows[0] as { id: string }).id;
    });
    return reply.code(201).send({ id: linkId });
  });
  app.post<{ Body: { provider?: string; email?: string; affiliateId?: string } }>("/v1/affiliate-email-links", { preHandler: authenticate }, async (req, reply) => {
    const b = req.body ?? {}; const ctx = as(req);
    if (!(PROVIDERS as readonly string[]).includes(b.provider ?? "")) return reply.code(400).send({ error: "invalid_provider" });
    const email = reqStr(b.email, 200, "invalid_email").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return reply.code(400).send({ error: "invalid_email" });
    if (!b.affiliateId || !UUID_RE.test(b.affiliateId)) return reply.code(400).send({ error: "invalid_affiliate" });
    const linkId = await tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "users.manage");
      const r = await c.query(`insert into affiliate_email_links (organization_id, project_id, provider, email, affiliate_id)
        select p.organization_id, p.id, $2, $3, a.id from projects p join affiliates a on a.project_id = p.id and a.id = $4 where p.id = $1
        on conflict (project_id, provider, email) do update set affiliate_id = excluded.affiliate_id returning id`, [ctx.projectId, b.provider, email, b.affiliateId]);
      if (!r.rows.length) throw new HttpError(400, "invalid_affiliate");
      return (r.rows[0] as { id: string }).id;
    });
    return reply.code(201).send({ id: linkId });
  });

  // ---- Público: recebe o webhook de venda. Segredo inválido = 401 e NADA é gravado. ----
  app.post<{ Params: { id: string }; Querystring: { token?: string } }>("/v1/hooks/sales/:id", async (req, reply) => {
    if (!d.systemUserId || !UUID_RE.test(req.params.id)) return reply.code(404).send({ error: "not_found" });
    const conn = ((await pool.query("select app.connector_lookup($1) as r", [req.params.id])).rows[0] as { r: { projectId: string; provider: Provider; secretSealed: string } | null }).r;
    if (!conn) return reply.code(404).send({ error: "not_found" });
    const given = (req.headers["x-webhook-token"] as string | undefined) ?? req.query.token ?? "";
    if (!eq(given, d.box.open(conn.secretSealed))) return reply.code(401).send({ error: "unauthorized" });
    const payload = (req.body ?? {}) as unknown;
    const eventId = mapSale(conn.provider, payload)?.eventId ?? `raw:${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 40)}`;
    const sys = { userId: d.systemUserId, projectId: conn.projectId };
    const out = await tx(pool, sys, async (c) => {
      // Organização suspensa não recebe vendas novas (o admin da plataforma ignora o bloqueio de escrita, então checamos aqui).
      const susp = ((await c.query("select app.org_suspended(organization_id) as s from projects where id = $1", [conn.projectId])).rows[0] as { s: boolean }).s;
      if (susp) throw new HttpError(423, "organization_suspended");
      const ing = ((await c.query("select app.ingest_sale_event($1,$2,$3,$4::jsonb,true) as r", [conn.projectId, conn.provider, eventId, JSON.stringify(payload)])).rows[0] as { r: { id: string; duplicate: boolean } }).r;
      if (ing.duplicate) return { duplicate: true, status: "duplicate" };
      return { duplicate: false, status: await processSaleEvent(c, d.vault, d.systemUserId!, ing.id) };
    });
    return reply.code(200).send(out);
  });

  app.get<{ Querystring: { status?: string } }>("/v1/sales-events", { preHandler: authenticate }, async (req) => {
    const ctx = as(req);
    return tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "products.manage", "users.manage");
      const rows = (await c.query(`select id, provider, event_id as "eventId", status, attempts, received_at as "receivedAt" from webhook_events_raw
        where ($1::text is null or status = $1) order by received_at desc limit 200`, [req.query.status ?? null])).rows;
      return { events: rows };
    });
  });
  // Depois de vincular um produto, reprocessa o que ficou 'unlinked'/'failed'.
  app.post("/v1/sales-events/reprocess", { preHandler: authenticate }, async (req) => {
    const ctx = as(req);
    return tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "products.manage");
      const ids = (await c.query("select id from webhook_events_raw where status in ('unlinked','failed') order by received_at limit 200")).rows as { id: string }[];
      const out: Record<string, number> = {};
      for (const e of ids) { const r = await processSaleEvent(c, d.vault, ctx.userId, e.id); out[r] = (out[r] ?? 0) + 1; }
      return { reprocessed: ids.length, outcomes: out };
    });
  });

  // ---- Contas de transportadora (credenciais seladas; nunca devolvidas) ----
  app.post<{ Body: { carrierKey?: string; isDefault?: boolean; credentials?: Record<string, any> } }>("/v1/carriers", { preHandler: authenticate }, async (req, reply) => {
    const b = req.body ?? {}; const ctx = as(req);
    if (b.carrierKey !== "jt") return reply.code(400).send({ error: "invalid_carrier" });
    const cr = b.credentials ?? {};
    for (const k of ["customerCode", "password", "apiAccount", "privateKey"]) reqStr(cr[k], 200, "invalid_credentials");
    if (cr.env !== "homolog" && cr.env !== "production") return reply.code(400).send({ error: "invalid_env" });
    const s = cr.sender ?? {};
    for (const k of ["name", "company", "postCode", "taxNumber", "phone", "prov", "city", "area", "street", "streetNumber"]) reqStr(s[k], 200, "invalid_sender");
    const sealed = d.box.seal(JSON.stringify({ customerCode: cr.customerCode, password: cr.password, apiAccount: cr.apiAccount, privateKey: cr.privateKey, env: cr.env, sender: s }));
    const aid = await tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "users.manage");
      if (b.isDefault) await c.query("update carrier_accounts set is_default = false where project_id = $1", [ctx.projectId]);
      const r = await c.query(`insert into carrier_accounts (organization_id, project_id, carrier_key, credentials_ref, credentials_sealed, is_default)
        select organization_id, id, 'jt', 'sealed', $2, $3 from projects where id = $1 returning id`, [ctx.projectId, sealed, !!b.isDefault]);
      const id = (r.rows[0] as { id: string }).id;
      await audit(c, ctx.userId, ctx.projectId, "carrier.create", "carrier_account", id, { carrier: "jt", env: cr.env });
      return id;
    });
    return reply.code(201).send({ id: aid, env: cr.env });
  });
  app.get("/v1/carriers", { preHandler: authenticate }, async (req) => {
    const ctx = as(req);
    return tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "users.manage");
      return { carriers: (await c.query(`select id, carrier_key as "carrierKey", enabled, is_default as "isDefault" from carrier_accounts order by created_at`)).rows };
    });
  });

  // ---- Etiqueta: cria o envio na transportadora, grava rastreio e avança o eixo de transporte ----
  app.post<{ Params: { id: string }; Body: { parcel?: any; invoice?: any; items?: any[]; recipientDocument?: string } }>("/v1/orders/:id/shipment", { preHandler: authenticate }, async (req, reply) => {
    const ctx = as(req); const b = req.body ?? {};
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    const p = b.parcel ?? {};
    for (const k of ["weightGrams", "lengthCm", "widthCm", "heightCm"]) if (!(typeof p[k] === "number" && p[k] > 0)) return reply.code(400).send({ error: "invalid_parcel" });
    const inv = b.invoice ?? {};
    for (const k of ["number", "series", "accessKey", "issuedAt", "issuerTaxId"]) if (typeof inv[k] !== "string" || !inv[k]) return reply.code(400).send({ error: "invalid_invoice" });
    const load = await tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "orders.edit");
      const o = (await c.query(`select o.id, o.tracking_code, o.total_cents, o.project_id, cu.name, cu.phone, cu.address, cu.cpf_encrypted, pl.name as plan_name
          from orders o left join customers cu on cu.id = o.customer_id left join product_plans pl on pl.id = o.plan_id where o.id = $1`, [req.params.id])).rows[0] as
        { id: string; tracking_code: string | null; total_cents: number; name: string | null; phone: string | null; address: Record<string, string>; cpf_encrypted: Buffer | null; plan_name: string | null } | undefined;
      if (!o) throw new HttpError(404, "not_found");
      if (o.tracking_code) throw new HttpError(409, "already_shipped");
      const car = await d.carriers(c, ctx.projectId);
      if (!car) throw new HttpError(409, "no_carrier");
      return { o, car };
    });
    const { o, car } = load;
    const doc = b.recipientDocument ?? (o.cpf_encrypted ? d.vault.decrypt(o.cpf_encrypted) : undefined);
    const a = o.address ?? {};
    let ship;
    try {
      ship = await car.adapter.createShipment({
        orderId: o.id, recipientName: o.name ?? "Cliente", recipientDocument: doc, recipientPhone: o.phone ?? undefined,
        destination: { zip: a.zip ?? "", uf: a.uf ?? "", city: a.city, street: a.street, number: a.number, district: a.district, complement: a.complement },
        parcel: p, totalCents: o.total_cents, items: b.items?.length ? b.items : [{ name: o.plan_name ?? "Produto", quantity: 1, unitCents: o.total_cents }], invoice: inv,
      });
    } catch (e) { return reply.code(422).send({ error: "carrier_rejected", message: (e as Error).message }); }
    await tx(pool, ctx, async (c) => {
      await c.query("select app.set_tracking($1,$2)", [o.id, ship.trackingCode]);
      await c.query("update orders set carrier_account_id = $2 where id = $1", [o.id, car.accountId]);
      await applyCarrierEvents(c, o.id, ctx.userId, [{ status: "aguardando_coleta", occurredAt: new Date() }]);
    });
    return reply.code(201).send({ trackingCode: ship.trackingCode, labelUrl: ship.labelUrl });
  });

  // Reenvio manual do rastreio à origem (reenfileira SHIPPING_REGISTER e zera o "sincronizado").
  app.post<{ Params: { id: string } }>("/v1/orders/:id/tracking/resend", { preHandler: authenticate }, async (req, reply) => {
    const ctx = as(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    return tx(pool, ctx, async (c) => {
      need(await granteeIn(c, ctx.userId, ctx.projectId), "orders.edit");
      const o = (await c.query("select tracking_code from orders where id = $1", [req.params.id])).rows[0] as { tracking_code: string | null } | undefined;
      if (!o) throw new HttpError(404, "not_found");
      if (!o.tracking_code) throw new HttpError(409, "no_tracking");
      await c.query("select app.set_tracking($1,$2)", [req.params.id, o.tracking_code]);
      return { ok: true };
    });
  });

  // ---- Público (white-label): somente status e histórico de transporte ----
  app.get<{ Params: { code: string } }>("/v1/track/:code", async (req, reply) => {
    const r = ((await pool.query("select app.public_tracking($1) as r", [req.params.code])).rows[0] as { r: unknown }).r;
    if (!r) return reply.code(404).send({ error: "not_found" });
    return { ...(r as object), carrier: "Enviado via J&T Express" };
  });
}
