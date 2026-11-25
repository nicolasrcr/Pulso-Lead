import { randomBytes } from "node:crypto";
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { tx, UUID_RE } from "../db.ts";
import { granteeIn, need, HttpError } from "../authz.ts";
import { assertPublicUrl } from "../webhooks/url-guard.ts";
import type { SecretBox } from "../webhooks/secret-box.ts";
import { audit } from "../audit.ts";

export const EVENTS = ["ORDER_CREATE", "CHARGE_UPDATED", "SHIPPING_REGISTER", "SHIPPING_UPDATE"] as const;
const newSecret = () => `whsec_${randomBytes(24).toString("hex")}`;

function checkUrl(u: unknown): string {
  if (typeof u !== "string" || u.length > 500) throw new HttpError(400, "invalid_url");
  try { assertPublicUrl(u); } catch { throw new HttpError(400, "invalid_url"); }
  return u;
}
function checkEvents(e: unknown): string[] {
  if (!Array.isArray(e) || e.length === 0 || e.some((x) => !(EVENTS as readonly string[]).includes(x))) throw new HttpError(400, "invalid_events");
  return [...new Set(e as string[])];
}

export function registerWebhookRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler, box: SecretBox) {
  const project = (req: { projectId?: string }) => {
    if (!req.projectId) throw new HttpError(400, "project_required");
    return req.projectId;
  };
  const admin = async (c: Parameters<typeof granteeIn>[0], req: { userId?: string }, pid: string) => need(await granteeIn(c, req.userId!, pid), "users.manage");

  app.post<{ Body: { name?: string; url?: string; events?: string[] } }>("/v1/webhooks", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const { name } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || name.length > 80) return reply.code(400).send({ error: "invalid_name" });
    const url = checkUrl(req.body?.url), events = checkEvents(req.body?.events);
    const secret = newSecret();
    const id = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      await admin(c, req, pid);
      return (await c.query(
        `insert into outbound_webhooks (organization_id, project_id, name, url, secret, events)
         select organization_id, id, $2, $3, $4, $5 from projects where id = $1 returning id`, [pid, name, url, box.seal(secret), events])).rows[0] as { id: string };
    });
    return reply.code(201).send({ ...id, secret }); // o segredo só aparece aqui
  });

  app.get("/v1/webhooks", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      await admin(c, req, pid);
      return { webhooks: (await c.query("select id, name, url, events, active from outbound_webhooks order by name")).rows };
    });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; url?: string; events?: string[]; active?: boolean } }>("/v1/webhooks/:id", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_webhook" });
    const b = req.body ?? {};
    const url = b.url !== undefined ? checkUrl(b.url) : null, events = b.events !== undefined ? checkEvents(b.events) : null;
    if (b.active !== undefined && typeof b.active !== "boolean") return reply.code(400).send({ error: "invalid_active" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      await admin(c, req, pid);
      const r = await c.query(
        `update outbound_webhooks set name = coalesce($2, name), url = coalesce($3, url), events = coalesce($4, events), active = coalesce($5, active)
          where id = $1 returning id`, [req.params.id, b.name ?? null, url, events, b.active ?? null]);
      if (!r.rows.length) throw new HttpError(404, "not_found");
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>("/v1/webhooks/:id/rotate-secret", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_webhook" });
    const secret = newSecret();
    await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      await admin(c, req, pid);
      const r = await c.query("update outbound_webhooks set secret = $2 where id = $1 returning id", [req.params.id, box.seal(secret)]);
      if (!r.rows.length) throw new HttpError(404, "not_found");
      await audit(c, req.userId!, pid, "webhook.rotate_secret", "outbound_webhook", req.params.id);
    });
    return { secret };
  });

  app.get<{ Querystring: { status?: string } }>("/v1/webhooks/deliveries", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    const status = req.query.status;
    if (status !== undefined && !["pending", "delivered", "failed"].includes(status)) throw new HttpError(400, "invalid_status");
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      await admin(c, req, pid);
      return { deliveries: (await c.query(
        `select id, webhook_id as "webhookId", event, status, attempts, last_status_code as "lastStatusCode", last_error as "lastError",
                next_attempt_at as "nextAttemptAt", created_at as "createdAt"
           from webhook_deliveries ${status ? "where status = $1" : ""} order by created_at desc limit 100`, status ? [status] : [])).rows };
    });
  });

  // Reenvio manual: volta para a fila com tentativas zeradas.
  app.post<{ Params: { id: string } }>("/v1/webhooks/deliveries/:id/resend", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_delivery" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      await admin(c, req, pid);
      const r = await c.query("update webhook_deliveries set status='pending', attempts=0, next_attempt_at=now(), last_error=null where id=$1 and status <> 'pending' returning id", [req.params.id]);
      if (!r.rows.length) throw new HttpError(404, "not_found");
      return { ok: true };
    });
  });

  // Rastreio (a Fase 3 chama o mesmo caminho quando a J&T devolve a etiqueta).
  app.post<{ Params: { id: string }; Body: { code?: string } }>("/v1/orders/:id/tracking", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "orders.edit");
      await c.query("select app.set_tracking($1,$2)", [req.params.id, req.body?.code ?? null]);
      return { ok: true };
    });
  });

  // Link assinado do afiliado (o segredo de assinatura nunca sai do banco).
  app.get<{ Params: { id: string }; Querystring: { planId?: string } }>("/v1/affiliates/:id/link", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const { planId } = req.query;
    if (!UUID_RE.test(req.params.id) || (planId !== undefined && !UUID_RE.test(planId))) return reply.code(400).send({ error: "invalid_id" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "users.manage");
      const token = ((await c.query("select app.affiliate_link($1,$2) as t", [req.params.id, planId ?? null])).rows[0] as { t: string }).t;
      return { token, path: `/r/${token}` };
    });
  });

  // Público: resolve o link sem sessão. 404 uniforme para qualquer token inválido.
  app.get<{ Params: { token: string } }>("/v1/links/:token", async (req, reply) => {
    const r = (await pool.query("select app.resolve_affiliate_link($1) as r", [req.params.token])).rows[0] as { r: { affiliateId: string; planId: string | null; projectId: string } | null };
    if (!r.r) return reply.code(404).send({ error: "not_found" });
    return { affiliateId: r.r.affiliateId, planId: r.r.planId, projectId: r.r.projectId };
  });
}
