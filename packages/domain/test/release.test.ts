import { describe, it, expect } from "vitest";
import { planRelease } from "../src/release";

describe("plano de liberação (BOM → movimentos de estoque)", () => {
  const bom = [{ stockItemId: "caixa", qty: 1 }, { stockItemId: "frasco", qty: 3 }];
  it("gera uma saída por item da BOM multiplicada pela quantidade", () => {
    const r = planRelease(bom, 2, { caixa: 10, frasco: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.movements).toEqual([
      { stockItemId: "caixa", delta: -2, reason: "release" },
      { stockItemId: "frasco", delta: -6, reason: "release" },
    ]);
  });
  it("estoque insuficiente lista todos os itens que faltam e não baixa nada", () => {
    const r = planRelease(bom, 2, { caixa: 1, frasco: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual([
      { stockItemId: "caixa", needed: 2, available: 1 },
      { stockItemId: "frasco", needed: 6, available: 5 },
    ]);
  });
  it("item sem saldo conhecido conta como zero", () => {
    const r = planRelease(bom, 1, { caixa: 5 });
    expect(r.ok).toBe(false);
  });
  it("BOM vazia libera sem movimentos", () => {
    expect(planRelease([], 1, {})).toEqual({ ok: true, movements: [] });
  });
  it("quantidade inválida é recusada", () => {
    expect(() => planRelease(bom, 0, {})).toThrow();
    expect(() => planRelease(bom, 1.5, {})).toThrow();
  });
  it("mesmo item repetido na BOM é somado", () => {
    const r = planRelease([{ stockItemId: "a", qty: 1 }, { stockItemId: "a", qty: 2 }], 1, { a: 3 });
    expect(r).toEqual({ ok: true, movements: [{ stockItemId: "a", delta: -3, reason: "release" }] });
  });
});
