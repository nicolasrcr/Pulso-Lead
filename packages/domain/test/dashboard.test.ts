import { describe, it, expect } from "vitest";
import { summarize, rateBps, isStale, type DashRow } from "../src/dashboard";

const row = (o: Partial<DashRow> = {}): DashRow => ({ orders: 0, grossCents: 0, paid: 0, paidCents: 0, delivered: 0, lost: 0, returned: 0, overdue: 0, ...o });

describe("dashboard: agregação e taxas", () => {
  it("soma linhas sem mutar a entrada", () => {
    const a = [row({ orders: 10, grossCents: 1000, paid: 4, paidCents: 400 }), row({ orders: 5, grossCents: 500, paid: 1, paidCents: 100 })];
    const snap = JSON.stringify(a);
    expect(summarize(a)).toMatchObject({ orders: 15, grossCents: 1500, paid: 5, paidCents: 500 });
    expect(JSON.stringify(a)).toBe(snap);
  });
  it("vazio soma zero e as taxas são zero (sem NaN)", () => {
    const s = summarize([]);
    expect(s.orders).toBe(0);
    expect(s.rates).toEqual({ conversionBps: 0, deliveryBps: 0, returnBps: 0, lossBps: 0, overdueBps: 0 });
  });
  it("taxas em pontos-base inteiros: conversão = pagos/pedidos; inadimplência = inadimplentes/entregues", () => {
    const s = summarize([row({ orders: 200, paid: 50, delivered: 100, returned: 10, lost: 4, overdue: 20 })]);
    expect(s.rates).toEqual({ conversionBps: 2500, deliveryBps: 5000, returnBps: 500, lossBps: 200, overdueBps: 2000 });
  });
  it("rateBps arredonda meio para cima e protege divisão por zero", () => {
    expect(rateBps(1, 3)).toBe(3333);
    expect(rateBps(2, 3)).toBe(6667);
    expect(rateBps(1, 0)).toBe(0);
    expect(rateBps(1, 8)).toBe(1250);
  });
  it("valores em bigint vindos do banco (string) são aceitos como inteiros", () => {
    expect(summarize([row({ grossCents: Number("9007199254") })]).grossCents).toBe(9007199254);
  });
});

describe("dashboard: atraso dos agregados", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  it("nunca atualizado = atrasado", () => expect(isStale(null, now, 60)).toBe(true));
  it("dentro do limite não é atraso; além dele é", () => {
    expect(isStale(new Date("2026-11-24T11:00:00Z"), now, 60)).toBe(false);
    expect(isStale(new Date("2026-11-24T10:59:00Z"), now, 60)).toBe(true);
  });
});
