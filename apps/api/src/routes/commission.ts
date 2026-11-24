import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { tx, UUID_RE } from "../db.ts";
import { granteeIn, need, HttpError } from "../authz.ts";

export function registerCommissionRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  const project = (req: { projectId?: string }) => {
    if (!req.projectId) throw new HttpError(400, "project_required");
    return req.projectId;
  };

  // O link_secret do afiliado nunca sai por aqui (é segredo de assinatura de link, Fase 6).
  app.get("/v1/affiliates", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "users.manage", "reports.read", "orders.read_all", "orders.create");
      return { affiliates: (await c.query("select id, name, active from affiliates order by name")).rows };
    });
  });

  app.post<{ Body: { name?: string } }>("/v1/affiliates", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const name = req.body?.name;
    if (typeof name !== "string" || !name.trim() || name.length > 120) return reply.code(400).send({ error: "invalid_name" });
    const row = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "users.manage");
      return (await c.query(
        "insert into affiliates (organization_id, project_id, name) select organization_id, id, $2 from projects where id = $1 returning id", [pid, name])).rows[0];
    });
    return reply.code(201).send(row);
  });

  // Saldo = créditos + estornos (estorno é negativo). Valores em centavos inteiros.
  app.get("/v1/commissions", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "reports.read", "orders.read_all", "dashboard.full");
      const rows = (await c.query(
        `select a.id as "affiliateId", a.name,
                coalesce(sum(l.amount_cents) filter (where l.kind = 'accrual'), 0)::int as "accruedCents",
                coalesce(sum(l.amount_cents) filter (where l.kind = 'reversal'), 0)::int as "reversedCents",
                coalesce(sum(l.amount_cents), 0)::int as "balanceCents"
           from affiliates a left join commission_ledger l on l.affiliate_id = a.id group by a.id, a.name order by a.name`)).rows;
      return { affiliates: rows };
    });
  });

  app.post<{ Params: { id: string }; Body: { disposition?: string; reason?: string } }>("/v1/orders/:id/return", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const { disposition, reason } = req.body ?? {};
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_order" });
    if (disposition !== "returned" && disposition !== "discarded") return reply.code(400).send({ error: "invalid_disposition" });
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 300)) return reply.code(400).send({ error: "invalid_reason" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "orders.edit");
      return ((await c.query("select app.register_return($1,$2,$3) as r", [req.params.id, disposition, reason ?? null])).rows[0] as { r: unknown }).r;
    });
  });

  // Gatilho manual da rotina de inadimplência; o agendamento por cron entra com os jobs (Fase 3).
  app.post("/v1/overdue/run", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "orders.status.all");
      return { marked: ((await c.query("select app.mark_overdue($1) as n", [pid])).rows[0] as { n: number }).n };
    });
  });
}
