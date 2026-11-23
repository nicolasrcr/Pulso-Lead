import { describe, it, expect } from "vitest";
import { accrueCommission, reverseCommission, balanceCents, type LedgerEntry } from "../src/commission";

const rule = { type: "percent", bps: 1000 } as const;

describe("ledger de comissão", () => {
  it("sem pagamento confirmado não há accrual", () => {
    const r = accrueCommission([], { orderId: "o1", affiliateId: "a1", rule, orderTotalCents: 10_000, paymentConfirmed: false });
    expect(r.created).toBe(false);
    expect(r.entries).toHaveLength(0);
  });

  it("accrual único por pedido (idempotente)", () => {
    const a = accrueCommission([], { orderId: "o1", affiliateId: "a1", rule, orderTotalCents: 10_000, paymentConfirmed: true });
    expect(a.created).toBe(true);
    const b = accrueCommission(a.entries, { orderId: "o1", affiliateId: "a1", rule, orderTotalCents: 10_000, paymentConfirmed: true });
    expect(b.created).toBe(false);
    expect(b.entries).toHaveLength(1);
    expect(balanceCents(b.entries, "a1")).toBe(1_000);
  });

  it("devolução após pagamento gera reversal exato, uma única vez", () => {
    const a = accrueCommission([], { orderId: "o1", affiliateId: "a1", rule, orderTotalCents: 12_345, paymentConfirmed: true });
    const r1 = reverseCommission(a.entries, { orderId: "o1", reason: "return" });
    expect(r1.created).toBe(true);
    expect(balanceCents(r1.entries, "a1")).toBe(0); // sem arredondamento perdido
    const r2 = reverseCommission(r1.entries, { orderId: "o1", reason: "return" });
    expect(r2.created).toBe(false);
    expect(r2.entries).toHaveLength(2);
  });

  it("devolução sem accrual prévio não cria lançamento", () => {
    const r = reverseCommission([], { orderId: "o9", reason: "return" });
    expect(r.created).toBe(false);
  });

  it("entradas são imutáveis (não altera o array recebido)", () => {
    const base: LedgerEntry[] = [];
    accrueCommission(base, { orderId: "o1", affiliateId: "a1", rule, orderTotalCents: 10_000, paymentConfirmed: true });
    expect(base).toHaveLength(0);
  });
});
