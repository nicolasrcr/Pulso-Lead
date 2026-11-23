import { describe, it, expect } from "vitest";
import { isOverdue } from "../src/overdue";

const d = (iso: string) => new Date(iso);

describe("inadimplência por prazo do projeto", () => {
  const delivered = d("2026-11-01T15:00:00Z");
  it("dia 15 ainda não é inadimplente; dia 16 é (prazo 15)", () => {
    expect(isOverdue({ deliveredAt: delivered, paid: false, now: d("2026-11-16T15:00:00Z"), graceDays: 15 })).toBe(false);
    expect(isOverdue({ deliveredAt: delivered, paid: false, now: d("2026-11-17T15:00:00Z"), graceDays: 15 })).toBe(true);
  });
  it("pagamento dentro do prazo nunca marca inadimplência", () => {
    expect(isOverdue({ deliveredAt: delivered, paid: true, now: d("2026-12-30T00:00:00Z"), graceDays: 15 })).toBe(false);
  });
  it("sem entrega não há inadimplência", () => {
    expect(isOverdue({ deliveredAt: null, paid: false, now: d("2026-12-30T00:00:00Z"), graceDays: 15 })).toBe(false);
  });
  it("prazo configurável por projeto", () => {
    expect(isOverdue({ deliveredAt: delivered, paid: false, now: d("2026-11-09T15:00:00Z"), graceDays: 7 })).toBe(true);
  });
});
