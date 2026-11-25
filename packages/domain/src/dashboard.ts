export interface DashRow {
  orders: number; grossCents: number; paid: number; paidCents: number;
  delivered: number; lost: number; returned: number; overdue: number;
}
export interface DashRates { conversionBps: number; deliveryBps: number; returnBps: number; lossBps: number; overdueBps: number }
export interface DashSummary extends DashRow { rates: DashRates }

/** Razão em pontos-base inteiros (meio para cima). Divisão por zero = 0, nunca NaN. */
export function rateBps(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 10_000 * 2 + whole) / (whole * 2));
}

/** Soma agregados (puro). Conversão/entrega/devolução/perda sobre pedidos; inadimplência sobre entregues. */
export function summarize(rows: readonly DashRow[]): DashSummary {
  const t: DashRow = { orders: 0, grossCents: 0, paid: 0, paidCents: 0, delivered: 0, lost: 0, returned: 0, overdue: 0 };
  for (const r of rows) {
    t.orders += r.orders; t.grossCents += r.grossCents; t.paid += r.paid; t.paidCents += r.paidCents;
    t.delivered += r.delivered; t.lost += r.lost; t.returned += r.returned; t.overdue += r.overdue;
  }
  return {
    ...t,
    rates: {
      conversionBps: rateBps(t.paid, t.orders), deliveryBps: rateBps(t.delivered, t.orders),
      returnBps: rateBps(t.returned, t.orders), lossBps: rateBps(t.lost, t.orders),
      overdueBps: rateBps(t.overdue, t.delivered),
    },
  };
}

/** O painel lê agregados: se não foram atualizados há mais de `maxMinutes`, o número pode estar defasado. */
export function isStale(refreshedAt: Date | null, now: Date, maxMinutes: number): boolean {
  if (!refreshedAt) return true;
  return now.getTime() - refreshedAt.getTime() > maxMinutes * 60_000;
}
