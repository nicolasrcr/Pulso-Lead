import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { can, isStale, summarize, toCsv, type DashRow } from "@pulso/domain";
import { tx } from "../db.ts";
import { granteeIn, HttpError } from "../authz.ts";
import type { Queryable } from "../tenant.ts";

const STALE_MINUTES = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const num = (v: unknown) => Number(v ?? 0);
const toRow = (r: Record<string, unknown>): DashRow => ({
  orders: num(r.orders), grossCents: num(r.gross), paid: num(r.paid), paidCents: num(r.paid_cents),
  delivered: num(r.delivered), lost: num(r.lost), returned: num(r.returned), overdue: num(r.overdue),
});
const SUMS = `sum(orders) as orders, sum(gross_cents) as gross, sum(paid) as paid, sum(paid_cents) as paid_cents,
              sum(delivered) as delivered, sum(lost) as lost, sum(returned) as returned, sum(overdue) as overdue`;

function range(q: { from?: string; to?: string }): { from: string; to: string } {
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const to = q.to ?? today;
  const from = q.from ?? new Date(Date.parse(to) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new HttpError(400, "invalid_date");
  if (from > to || (Date.parse(to) - Date.parse(from)) / DAY_MS > 365) throw new HttpError(400, "invalid_range");
  return { from, to };
}

/** Projetos visíveis ao usuário em que ele tem dashboard.full. Com x-project-id, só aquele (sem a capability = 403). */
async function allowedProjects(c: Queryable, userId: string, projectId?: string) {
  const visible = (await c.query("select id, name from projects order by name")).rows as { id: string; name: string }[];
  const picked = projectId ? visible.filter((p) => p.id === projectId) : visible;
  const ok: { id: string; name: string }[] = [];
  for (const p of picked) if (can(await granteeIn(c, userId, p.id), "dashboard.full")) ok.push(p);
  if (ok.length === 0) throw new HttpError(403, "forbidden");
  return ok;
}

export function registerDashboardRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  app.get<{ Querystring: { from?: string; to?: string } }>("/v1/dashboard", { preHandler: authenticate }, async (req) => {
    const { from, to } = range(req.query);
    return tx(pool, { userId: req.userId!, projectId: req.projectId }, async (c) => {
      const projects = await allowedProjects(c, req.userId!, req.projectId);
      const ids = projects.map((p) => p.id);
      const where = "project_id = any($1::uuid[]) and day between $2 and $3";
      const args = [ids, from, to];
      const [byProj, byDay, byAff, byUf, refresh] = await Promise.all([
        c.query(`select project_id, ${SUMS} from dash_daily where ${where} group by project_id`, args),
        c.query(`select day::text as day, ${SUMS} from dash_daily where ${where} group by day order by day`, args),
        c.query(`select a.id, a.name, sum(d.orders) as orders, sum(d.gross_cents) as gross, sum(d.paid) as paid, sum(d.paid_cents) as paid_cents,
                        sum(d.delivered) as delivered, sum(d.lost) as lost, sum(d.returned) as returned, sum(d.overdue) as overdue
                   from dash_daily d join affiliates a on a.id = d.affiliate_id
                  where d.project_id = any($1::uuid[]) and d.day between $2 and $3
                  group by a.id, a.name order by sum(d.paid_cents) desc limit 10`, args),
        c.query(`select uf, ${SUMS} from dash_daily where ${where} and uf is not null group by uf order by sum(paid_cents) desc limit 10`, args),
        c.query("select project_id, refreshed_at from dash_refresh where project_id = any($1::uuid[])", [ids]),
      ]);
      const now = new Date();
      const refreshedBy = new Map((refresh.rows as { project_id: string; refreshed_at: Date }[]).map((r) => [r.project_id, r.refreshed_at]));
      const rowOf = new Map((byProj.rows as Record<string, unknown>[]).map((r) => [r.project_id as string, toRow(r)]));
      const perProject = projects.map((p) => {
        const at = refreshedBy.get(p.id) ?? null;
        return { projectId: p.id, name: p.name, ...summarize(rowOf.get(p.id) ? [rowOf.get(p.id)!] : []), refreshedAt: at, stale: isStale(at, now, STALE_MINUTES) };
      }).sort((a, b) => b.paidCents - a.paidCents);
      const mapRows = (rows: unknown[], key: string) => (rows as Record<string, unknown>[]).map((r) => ({ [key]: r[key], ...(r.name ? { name: r.name } : {}), ...summarize([toRow(r)]) }));
      return {
        range: { from, to },
        scope: req.projectId ? "project" : "all",
        total: summarize(perProject),
        byProject: perProject,
        byDay: mapRows(byDay.rows, "day"),
        byAffiliate: mapRows(byAff.rows, "id"),
        byUf: mapRows(byUf.rows, "uf"),
        anyStale: perProject.some((p) => p.stale),
      };
    });
  });

  // Atualização sob demanda de um projeto (o cron/jobs chamam a mesma função no banco).
  app.post("/v1/dashboard/refresh", { preHandler: authenticate }, async (req) => {
    if (!req.projectId) throw new HttpError(400, "project_required");
    return tx(pool, { userId: req.userId!, projectId: req.projectId }, async (c) => {
      await allowedProjects(c, req.userId!, req.projectId);
      return { rows: ((await c.query("select app.refresh_dash($1) as n", [req.projectId])).rows[0] as { n: number }).n };
    });
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/v1/dashboard/export.csv", { preHandler: authenticate }, async (req, reply) => {
    const { from, to } = range(req.query);
    const csv = await tx(pool, { userId: req.userId!, projectId: req.projectId }, async (c) => {
      const projects = await allowedProjects(c, req.userId!, req.projectId);
      const rows = (await c.query(
        `select p.name as projeto, d.day::text as dia, coalesce(d.uf::text,'') as uf, a.name as afiliado,
                d.orders as pedidos, d.gross_cents as bruto_centavos, d.paid as pagos, d.paid_cents as pago_centavos,
                d.delivered as entregues, d.lost as perdidos, d.returned as devolvidos, d.overdue as inadimplentes
           from dash_daily d join projects p on p.id = d.project_id left join affiliates a on a.id = d.affiliate_id
          where d.project_id = any($1::uuid[]) and d.day between $2 and $3 order by d.day, p.name`, [projects.map((p) => p.id), from, to])).rows as Record<string, unknown>[];
      const norm = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) && k.endsWith("centavos") ? Number(v) : v])));
      return toCsv(norm, ["projeto", "dia", "uf", "afiliado", "pedidos", "bruto_centavos", "pagos", "pago_centavos", "entregues", "perdidos", "devolvidos", "inadimplentes"]);
    });
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="dashboard-${from}_${to}.csv"`).send(csv);
  });
}
