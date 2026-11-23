import { describe, it, expect } from "vitest";
import { commissionCents } from "../src/money";

describe("commissionCents (dinheiro em centavos inteiros)", () => {
  it("percentual em basis points, arredonda meio para cima", () => {
    expect(commissionCents({ type: "percent", bps: 1000 }, 12_345)).toBe(1_235); // 10% de 123,45 = 12,345 -> 12,35
  });
  it("valor fixo ignora o total", () => {
    expect(commissionCents({ type: "fixed", cents: 2_500 }, 99_999)).toBe(2_500);
  });
  it("nunca devolve não-inteiro nem negativo", () => {
    for (const total of [1, 3, 7, 999, 10_001]) {
      const c = commissionCents({ type: "percent", bps: 333 }, total);
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
    }
  });
  it("recusa entrada que não seja inteiro", () => {
    expect(() => commissionCents({ type: "percent", bps: 1000 }, 10.5)).toThrow();
    expect(() => commissionCents({ type: "fixed", cents: 1.5 }, 100)).toThrow();
  });
});
