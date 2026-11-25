import type pg from "pg";
import { applyShippingEvent, canTransition, SHIPPING_STATUSES, type CarrierAdapter, type ShippingStatus } from "@pulso/domain";
import { tx } from "../db.ts";
import type { Queryable } from "../tenant.ts";
import type { CarrierFactory } from "../carriers.ts";

/** Menor caminho válido entre dois estados (transportadoras pulam scans). Máx. 4 passos; exceções vão direto. */
export function pathTo(from: ShippingStatus, to: ShippingStatus): ShippingStatus[] | null {
  if (canTransition(from, to)) return [to];
  const q: ShippingStatus[][] = [[from]]; const seen = new Set<ShippingStatus>([from]);
  while (q.length) {
    const p = q.shift()!;
    if (p.length > 4) break;
    for (const n of SHIPPING_STATUSES) {
      if (seen.has(n) || !canTransition(p[p.length - 1]!, n)) continue;
      if (n === to) return [...p.slice(1), n];
      seen.add(n); q.push([...p, n]);
    }
  }
  return null;
}

export interface ApplyStats { applied: number; skipped: number }

/** Aplica eventos (já normalizados) de um pedido. Idempotente: reaplicar o mesmo lote não muda nada. */
export async function applyCarrierEvents(c: Queryable, orderId: string, actorId: string, events: { status: ShippingStatus; occurredAt: Date }[]): Promise<ApplyStats> {
  const stats: ApplyStats = { applied: 0, skipped: 0 };
  const row = (await c.query("select shipping_status, shipping_last_event_at from order_status where order_id = $1 for update", [orderId])).rows[0] as { shipping_status: ShippingStatus; shipping_last_event_at: Date | null } | undefined;
  if (!row) return stats;
  let state = { status: row.shipping_status, lastEventAt: row.shipping_last_event_at };
  for (const ev of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    if (ev.status === "desconhecido") { stats.skipped++; continue; }
    if (state.lastEventAt && ev.occurredAt.getTime() < state.lastEventAt.getTime()) { stats.skipped++; continue; }
    if (ev.status === state.status) { stats.skipped++; continue; }
    const path = pathTo(state.status, ev.status);
    if (!path) { stats.skipped++; continue; }
    for (const step of path) {
      const res = applyShippingEvent(state, { status: step, occurredAt: ev.occurredAt });
      if (!res.applied) { stats.skipped++; break; }
      const ok = ((await c.query("select app.transition_order($1,'shipping',$2,$3,$4,$5) as ok", [orderId, state.status, step, ev.occurredAt, actorId])).rows[0] as { ok: boolean }).ok;
      if (!ok) { stats.skipped++; break; }
      state = res.state; stats.applied++;
    }
  }
  return stats;
}

export interface SyncDeps { systemUserId: string; carriers: CarrierFactory; batch?: number; minIntervalSec?: number }
export interface SyncResult { polled: number; applied: number; errors: number }

/** Job: consulta o rastreio dos pedidos em trânsito (os consultados há mais tempo primeiro) e aplica os eventos. */
export async function syncTrackingAll(pool: pg.Pool, d: SyncDeps): Promise<SyncResult> {
  const out: SyncResult = { polled: 0, applied: 0, errors: 0 };
  const projects = await tx(pool, { userId: d.systemUserId }, async (c) => (await c.query("select id from projects where not app.org_suspended(organization_id)")).rows as { id: string }[]);
  for (const p of projects) {
    const due = await tx(pool, { userId: d.systemUserId, projectId: p.id }, async (c) => (await c.query(
      `select o.id, o.tracking_code, o.carrier_account_id from orders o join order_status s on s.order_id = o.id
        where o.project_id = $1 and o.tracking_code is not null
          and s.shipping_status not in ('entregue','entregue_caixa','devolvido','retornado_reverso','perdido','roubado','cancelado','etiqueta_cancelada','apreendido')
          and (o.tracking_polled_at is null or o.tracking_polled_at < now() - make_interval(secs => $2))
        order by o.tracking_polled_at nulls first limit $3`, [p.id, d.minIntervalSec ?? 300, d.batch ?? 50])).rows as { id: string; tracking_code: string; carrier_account_id: string | null }[]);
    for (const o of due) {
      out.polled++;
      let adapter: CarrierAdapter | null = null;
      try {
        // Credenciais e HTTP fora da transação de escrita: a chamada externa não segura lock.
        adapter = (await tx(pool, { userId: d.systemUserId, projectId: p.id }, (c) => d.carriers(c, p.id, o.carrier_account_id)))?.adapter ?? null;
        if (!adapter) throw new Error("sem conta de transportadora ativa");
        const events = await adapter.track(o.tracking_code);
        out.applied += await tx(pool, { userId: d.systemUserId, projectId: p.id }, async (c) => {
          const r = await applyCarrierEvents(c, o.id, d.systemUserId, events);
          await c.query("update orders set tracking_polled_at = now() where id = $1", [o.id]);
          return r.applied;
        });
      } catch (e) {
        out.errors++;
        await tx(pool, { userId: d.systemUserId, projectId: p.id }, (c) => c.query("update orders set tracking_polled_at = now(), tracking_sync_error = $2 where id = $1", [o.id, (e as Error).message.slice(0, 300)]));
      }
    }
  }
  return out;
}
