const DAY_MS = 86_400_000;

/** Inadimplente só depois de `graceDays` dias completos após a entrega, sem pagamento. */
export function isOverdue(i: { deliveredAt: Date | null; paid: boolean; now: Date; graceDays: number }): boolean {
  if (i.paid || !i.deliveredAt) return false;
  const elapsedDays = Math.floor((i.now.getTime() - i.deliveredAt.getTime()) / DAY_MS);
  return elapsedDays > i.graceDays;
}
