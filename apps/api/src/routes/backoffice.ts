import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { tx, UUID_RE } from "../db.ts";
import { HttpError } from "../authz.ts";
import type { Queryable } from "../tenant.ts";

const STATUSES = ["garantia", "ativo", "em_atraso", "suspenso", "encerrado"];

/** Back-office do fornecedor. Toda rota exige admin da plataforma (checado no servidor E nas funções SQL). */
export function registerBackofficeRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  const guard = async (c: Queryable) => {
    const ok = ((await c.query("select app.is_platform_admin() as ok")).rows[0] as { ok: boolean }).ok;
    if (!ok) throw new HttpError(403, "forbidden");
  };
  const org = (id: string) => { if (!UUID_RE.test(id)) throw new HttpError(400, "invalid_organization"); return id; };

  app.get("/v1/backoffice/overview", { preHandler: authenticate }, async (req) =>
    tx(pool, { userId: req.userId! }, async (c) => {
      await guard(c);
      const rows = (await c.query("select x as o from app.backoffice_overview() x")).rows as { o: Record<string, unknown> }[];
      return { organizations: rows.map((r) => r.o) };
    }));

  app.post<{ Params: { id: string }; Body: { planKey?: string; monthlyFeeCents?: number; orderCap?: number } }>("/v1/backoffice/organizations/:id/subscription", { preHandler: authenticate }, async (req, reply) => {
    const b = req.body ?? {};
    if (typeof b.planKey !== "string" || !Number.isInteger(b.monthlyFeeCents) || !Number.isInteger(b.orderCap)) return reply.code(400).send({ error: "invalid_subscription" });
    const id = await tx(pool, { userId: req.userId! }, async (c) => {
      await guard(c);
      return ((await c.query("select app.create_subscription($1,$2,$3,$4) as id", [org(req.params.id), b.planKey, b.monthlyFeeCents, b.orderCap])).rows[0] as { id: string }).id;
    });
    return reply.code(201).send({ id });
  });

  app.post<{ Params: { id: string }; Body: { to?: string; reason?: string } }>("/v1/backoffice/organizations/:id/status", { preHandler: authenticate }, async (req, reply) => {
    const { to, reason } = req.body ?? {};
    if (typeof to !== "string" || !STATUSES.includes(to) || (reason !== undefined && (typeof reason !== "string" || reason.length > 500))) return reply.code(400).send({ error: "invalid_status" });
    await tx(pool, { userId: req.userId! }, async (c) => {
      await guard(c);
      await c.query("select app.set_subscription_status($1,$2,$3)", [org(req.params.id), to, reason ?? null]);
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { confirm?: string } }>("/v1/backoffice/organizations/:id/discard-pii", { preHandler: authenticate }, async (req) =>
    tx(pool, { userId: req.userId! }, async (c) => {
      await guard(c);
      return ((await c.query("select app.discard_org_pii($1,$2) as r", [org(req.params.id), req.body?.confirm ?? ""])).rows[0] as { r: unknown }).r;
    }));

  app.get<{ Querystring: { organizationId?: string } }>("/v1/backoffice/audit", { preHandler: authenticate }, async (req) =>
    tx(pool, { userId: req.userId! }, async (c) => {
      await guard(c);
      const o = req.query.organizationId;
      if (o && !UUID_RE.test(o)) throw new HttpError(400, "invalid_organization");
      return { entries: (await c.query(`select id, organization_id as "organizationId", actor_id as "actorId", action, meta, at from platform_audit_log
        where ($1::uuid is null or organization_id = $1) order by id desc limit 200`, [o ?? null])).rows };
    }));
}
