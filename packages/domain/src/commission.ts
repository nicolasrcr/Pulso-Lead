import { commissionCents, type CommissionRule } from "./money";

export interface LedgerEntry {
  id: string;
  orderId: string;
  affiliateId: string;
  kind: "accrual" | "reversal";
  amountCents: number; // accrual positivo, reversal negativo
  reason?: string;
}

export interface AccrueInput {
  orderId: string; affiliateId: string; rule: CommissionRule;
  orderTotalCents: number; paymentConfirmed: boolean;
}

/** Crédito só na confirmação do pagamento; um único accrual por pedido. Não muta o ledger recebido. */
export function accrueCommission(entries: readonly LedgerEntry[], i: AccrueInput): { entries: LedgerEntry[]; created: boolean } {
  const exists = entries.some((e) => e.orderId === i.orderId && e.kind === "accrual");
  if (!i.paymentConfirmed || exists) return { entries: [...entries], created: false };
  const amountCents = commissionCents(i.rule, i.orderTotalCents);
  const entry: LedgerEntry = { id: `acc:${i.orderId}`, orderId: i.orderId, affiliateId: i.affiliateId, kind: "accrual", amountCents };
  return { entries: [...entries, entry], created: true };
}

/** Estorno em devolução: espelha exatamente o accrual (sem recalcular), uma única vez. */
export function reverseCommission(entries: readonly LedgerEntry[], i: { orderId: string; reason: string }): { entries: LedgerEntry[]; created: boolean } {
  const accrual = entries.find((e) => e.orderId === i.orderId && e.kind === "accrual");
  const reversed = entries.some((e) => e.orderId === i.orderId && e.kind === "reversal");
  if (!accrual || reversed) return { entries: [...entries], created: false };
  const entry: LedgerEntry = {
    id: `rev:${i.orderId}`, orderId: i.orderId, affiliateId: accrual.affiliateId,
    kind: "reversal", amountCents: -accrual.amountCents, reason: i.reason,
  };
  return { entries: [...entries, entry], created: true };
}

export function balanceCents(entries: readonly LedgerEntry[], affiliateId: string): number {
  return entries.filter((e) => e.affiliateId === affiliateId).reduce((s, e) => s + e.amountCents, 0);
}
