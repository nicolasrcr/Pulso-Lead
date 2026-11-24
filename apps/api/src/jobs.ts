import type pg from "pg";
import { tx } from "./db.ts";
import { dispatchDue, type DispatchDeps } from "./webhooks/dispatcher.ts";

/** Atualiza os agregados do dashboard de todos os projetos (a cada hora). */
export async function refreshAllDashboards(pool: pg.Pool, systemUserId: string): Promise<number> {
  const ids = await tx(pool, { userId: systemUserId }, async (c) => (await c.query("select id from projects")).rows as { id: string }[]);
  for (const p of ids) await tx(pool, { userId: systemUserId, projectId: p.id }, (c) => c.query("select app.refresh_dash($1)", [p.id]));
  return ids.length;
}

/** Marca inadimplentes em todos os projetos (diário). Idempotente. */
export async function markOverdueAll(pool: pg.Pool, systemUserId: string): Promise<number> {
  const ids = await tx(pool, { userId: systemUserId }, async (c) => (await c.query("select id from projects")).rows as { id: string }[]);
  let total = 0;
  for (const p of ids) total += await tx(pool, { userId: systemUserId, projectId: p.id }, async (c) => ((await c.query("select app.mark_overdue($1) as n", [p.id])).rows[0] as { n: number }).n);
  return total;
}

/** Laço de produção: webhooks a cada 10 s, dashboards a cada hora, inadimplência a cada 6 h. Erros não derrubam o processo. */
export function startJobs(pool: pg.Pool, deps: DispatchDeps, log: (m: string) => void = console.log): () => void {
  const guard = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => log(`job ${name} falhou: ${(e as Error).message}`));
  const timers = [
    setInterval(guard("webhooks", () => dispatchDue(pool, deps)), 10_000),
    setInterval(guard("dashboards", () => refreshAllDashboards(pool, deps.systemUserId)), 3_600_000),
    setInterval(guard("inadimplencia", () => markOverdueAll(pool, deps.systemUserId)), 6 * 3_600_000),
  ];
  return () => timers.forEach(clearInterval);
}
