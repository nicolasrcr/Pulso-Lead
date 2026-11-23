export type CommissionRule =
  | { type: "percent"; bps: number } // basis points: 1000 = 10%
  | { type: "fixed"; cents: number };

function assertInt(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${name} deve ser inteiro não negativo (centavos)`);
}

/** Comissão em centavos inteiros. Percentual arredonda meio para cima. Nunca usa float em estado persistido. */
export function commissionCents(rule: CommissionRule, orderTotalCents: number): number {
  assertInt(orderTotalCents, "orderTotalCents");
  if (rule.type === "fixed") {
    assertInt(rule.cents, "cents");
    return rule.cents;
  }
  assertInt(rule.bps, "bps");
  return Math.floor((orderTotalCents * rule.bps + 5_000) / 10_000);
}
