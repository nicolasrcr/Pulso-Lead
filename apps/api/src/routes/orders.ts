import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { can, isValidCpf, maskCpf, maskPhone, normalizePhone } from "@pulso/domain";
import { canTransitionAxis, deriveBuckets, posPagoV1 } from "@pulso/templates";
import { tx, UUID_RE } from "../db.ts";
import { granteeIn, need, HttpError } from "../authz.ts";
import type { CpfVault } from "../auth/cpf-vault.ts";

const TEMPLATES = { [posPagoV1.key]: posPagoV1 };
const DELIVERED = ["entregue", "entregue_caixa"];
const str = (v: unknown, max = 120) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

interface CreateBody {
  planId?: string; affiliateId?: string; externalId?: string; afterPay?: boolean; scheduledFor?: string; totalCents?: number;
  customer?: { name?: string; cpf?: string; phone?: string; email?: string; address?: Record<string, unknown> };
}

export function registerOrderRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler, vault: CpfVault) {
  const project = (req: { projectId?: string }) => {
    if (!req.projectId) throw new HttpError(400, "project_required");
    return req.projectId;
  };
  const templateOf = async (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, pid: string) => {
    const key = ((await c.query("select template_key from projects where id = $1", [pid])).rows[0] as { template_key: string }).template_key;
    const t = (TEMPLATES as Record<string, typeof posPagoV1>)[key];
    if (!t) throw new HttpError(500, "template_unavailable");
    return t;
  };

  app.post<{ Body: CreateBody }>("/v1/orders", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const b = req.body ?? {};
    const cu = b.customer ?? {};
    if (typeof b.planId !== "string" || !UUID_RE.test(b.planId)) return reply.code(400).send({ error: "invalid_plan" });
    if (!str(cu.name)) return reply.code(400).send({ error: "invalid_customer" });
    if (cu.cpf !== undefined && !isValidCpf(cu.cpf)) return reply.code(400).send({ error: "invalid_cpf" });
    if (b.affiliateId !== undefined && !UUID_RE.test(b.affiliateId)) return reply.code(400).send({ error: "invalid_affiliate" });
    if (b.externalId !== undefined && !str(b.externalId, 120)) return reply.code(400).send({ error: "invalid_external_id" });
    if (b.scheduledFor !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(b.scheduledFor)) return reply.code(400).send({ error: "invalid_date" });
    if (b.totalCents !== undefined && !(Number.isInteger(b.totalCents) && b.totalCents >= 0)) return reply.code(400).send({ error: "invalid_total" });

    const out = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "orders.create");
      const plan = (await c.query("select price_cents from product_plans where id = $1 and active", [b.planId])).rows[0] as { price_cents: number } | undefined;
      if (!plan) throw new HttpError(400, "invalid_plan");
      const customer = { name: cu.name, phone: cu.phone ? normalizePhone(cu.phone) : null, email: cu.email ?? null,
                         address: cu.address ?? {}, cpf_hash: cu.cpf ? vault.hash(cu.cpf) : null };
      const r = (await c.query("select app.create_order($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,'created',null) as r", [
        pid, b.planId, b.affiliateId ?? null, JSON.stringify(customer), cu.cpf ? vault.encrypt(cu.cpf) : null,
        b.totalCents ?? plan.price_cents, b.afterPay ?? true, b.scheduledFor ?? null, b.externalId ?? null])).rows[0] as { r: { id: string; created: boolean; volume: unknown } };
      return r.r;
    });
    return reply.code(out.created ? 201 : 200).send(out);
  });

  // Visibilidade: orders.read_all vê o projeto inteiro; senão, só os pedidos que o próprio usuário criou.
  // Paginação por cursor (created_at, id): estável com inserções concorrentes e sem OFFSET. O cursor carrega o
  // created_at em texto com a precisão total do Postgres (microssegundos), que o Date do JS perderia.
  const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`).toString("base64url");
  const decodeCursor = (raw: string): { at: string; id: string } | null => {
    const m = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?[+-]\d\d(?::?\d\d)?)\|([0-9a-f-]{36})$/i.exec(Buffer.from(raw, "base64url").toString("utf8"));
    return m && UUID_RE.test(m[2]!) ? { at: m[1]!, id: m[2]! } : null;
  };
  const listSql = (all: boolean, keyset: boolean) => {
    const where = [all ? "" : "o.created_by = $1", keyset ? `(o.created_at, o.id) < ($${all ? 1 : 2}::timestamptz, $${all ? 2 : 3}::uuid)` : ""].filter(Boolean).join(" and ");
    return `
    select o.id, o.external_id as "externalId", o.total_cents as "totalCents", o.after_pay as "afterPay", o.released_at as "releasedAt",
           o.created_at as "createdAt", o.created_at::text as "_cursorAt", c.name as "customerName", c.phone as "customerPhone",
           s.platform_status as platform, s.shipping_status as shipping, s.payment_status as payment
      from orders o join order_status s on s.order_id = o.id left join customers c on c.id = o.customer_id
     ${where ? `where ${where}` : ""} order by o.created_at desc, o.id desc limit __LIMIT__`;
  };

  app.get<{ Querystring: { limit?: string; cursor?: string } }>("/v1/orders", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 200 : /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!(limit >= 1 && limit <= 200)) return reply.code(400).send({ error: "invalid_limit" });
    const cur = req.query.cursor === undefined ? null : decodeCursor(req.query.cursor);
    if (req.query.cursor !== undefined && !cur) return reply.code(400).send({ error: "invalid_cursor" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      const g = await granteeIn(c, req.userId!, pid);
      need(g, "orders.read_all", "orders.create", "orders.edit", "dashboard.own");
      const t = await templateOf(c, pid);
      const all = can(g, "orders.read_all");
      const params: unknown[] = all ? [] : [req.userId];
      if (cur) params.push(cur.at, cur.id);
      params.push(limit + 1);
      const sql = listSql(all, !!cur).replace("__LIMIT__", `$${params.length}`);
      const fetched = (await c.query(sql, params)).rows as Record<string, any>[];
      const rows = fetched.slice(0, limit);
      const last = rows[rows.length - 1];
      return { orders: rows.map(({ _cursorAt, ...r }) => ({ ...r, customerPhone: r.customerPhone ? maskPhone(r.customerPhone) : null,
        buckets: deriveBuckets(t, { platform: r.platform, shipping: r.shipping, payment: r.payment }) })),
        nextCursor: fetched.length > limit && last ? encodeCursor(last._cursorAt, last.id) : null };
    });
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      const g = await granteeIn(c, req.userId!, pid);
      need(g, "orders.read_all", "orders.create", "orders.edit", "dashboard.own");
      const o = (await c.query(
        `select o.id, o.created_by, o.total_cents as "totalCents", o.after_pay as "afterPay", o.released_at as "releasedAt", o.external_id as "externalId",
                c.name as "customerName", c.phone, c.email, c.address, c.cpf_encrypted,
                s.platform_status as platform, s.shipping_status as shipping, s.payment_status as payment, s.paid_at as "paidAt", s.delivered_at as "deliveredAt"
           from orders o join order_status s on s.order_id = o.id left join customers c on c.id = o.customer_id where o.id = $1`, [req.params.id])).rows[0] as Record<string, any> | undefined;
      if (!o || (!can(g, "orders.read_all") && o.created_by !== req.userId)) throw new HttpError(404, "not_found");
      const { cpf_encrypted, created_by, phone, ...rest } = o;
      const events = (await c.query(`select axis, from_value as "from", to_value as "to", occurred_at as "at" from order_events where order_id = $1 order by id`, [req.params.id])).rows;
      return { ...rest, phone: phone ? maskPhone(phone) : null, cpf: cpf_encrypted ? maskCpf(vault.decrypt(cpf_encrypted)) : null, events };
    });
  });

  // Revelar CPF é ação sensível: exige orders.edit e deixa trilha em audit_log.
  app.post<{ Params: { id: string } }>("/v1/orders/:id/reveal-cpf", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "orders.edit");
      const o = (await c.query(`select o.organization_id, c.cpf_encrypted from orders o left join customers c on c.id = o.customer_id where o.id = $1`, [req.params.id])).rows[0] as { organization_id: string; cpf_encrypted: Buffer | null } | undefined;
      if (!o || !o.cpf_encrypted) throw new HttpError(404, "not_found");
      await c.query("insert into audit_log (organization_id, project_id, actor_id, action, entity, entity_id) values ($1,$2,$3,'cpf.reveal','order',$4)", [o.organization_id, pid, req.userId, req.params.id]);
      return { cpf: vault.decrypt(o.cpf_encrypted) };
    });
  });

  app.post<{ Params: { id: string } }>("/v1/orders/:id/release", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "orders.edit");
      return ((await c.query("select app.release_order($1) as r", [req.params.id])).rows[0] as { r: unknown }).r;
    }).catch((e) => {
      if ((e as { code?: string }).code === "55000") return reply.code(409).send({ error: "insufficient_stock" });
      throw e;
    });
  });

  // Envio (shipping) é dirigido por eventos da transportadora; manualmente só plataforma e pagamento.
  app.post<{ Params: { id: string }; Body: { axis?: string; from?: string; to?: string } }>("/v1/orders/:id/transition", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const { axis, from, to } = req.body ?? {};
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    if ((axis !== "platform" && axis !== "payment") || !str(from, 60) || !str(to, 60)) return reply.code(400).send({ error: "invalid_transition" });
    const ok = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      const g = await granteeIn(c, req.userId!, pid);
      const o = (await c.query(`select o.created_by, s.shipping_status from orders o join order_status s on s.order_id = o.id where o.id = $1`, [req.params.id])).rows[0] as { created_by: string | null; shipping_status: string } | undefined;
      if (!o) throw new HttpError(404, "not_found");
      const ownAfterDelivery = can(g, "orders.status.own_after_delivery") && o.created_by === req.userId && DELIVERED.includes(o.shipping_status);
      if (!(can(g, "orders.status.all") || (axis === "payment" && can(g, "billing.status")) || ownAfterDelivery)) throw new HttpError(403, "forbidden");
      if (!canTransitionAxis(await templateOf(c, pid), axis, from!, to!)) throw new HttpError(400, "invalid_transition");
      return ((await c.query("select app.transition_order($1,$2,$3,$4,now(),$5) as ok", [req.params.id, axis, from, to, req.userId])).rows[0] as { ok: boolean }).ok;
    });
    return ok ? { ok: true } : reply.code(409).send({ error: "stale_state" });
  });

  app.get("/v1/kanban", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      const g = await granteeIn(c, req.userId!, pid);
      need(g, "orders.read_all", "dashboard.full", "dashboard.own", "orders.create");
      const t = await templateOf(c, pid);
      const all = can(g, "orders.read_all");
      const rows = (await c.query(
        `select s.platform_status as platform, s.shipping_status as shipping, s.payment_status as payment, count(*)::int as n
           from orders o join order_status s on s.order_id = o.id ${all ? "" : "where o.created_by = $1"} group by 1,2,3`, all ? [] : [req.userId])).rows as { platform: string; shipping: string; payment: string; n: number }[];
      const counts: Record<string, number> = Object.fromEntries(t.kanban.map((k) => [k.key, 0]));
      for (const r of rows) for (const k of deriveBuckets(t, r)) counts[k] = (counts[k] ?? 0) + r.n;
      return { buckets: t.kanban.map((k) => ({ key: k.key, label: k.label, count: counts[k.key] })) };
    });
  });

  app.get("/v1/volume", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "dashboard.full", "orders.read_all", "orders.create", "users.manage");
      const org = ((await c.query("select organization_id from projects where id = $1", [pid])).rows[0] as { organization_id: string }).organization_id;
      return (await c.query("select used, cap, pct, alert, over from app.volume_status($1)", [org])).rows[0];
    });
  });
}
