import { describe, it, expect } from "vitest";
import { VolumeCounter } from "../src/volume";

describe("contador de volume (mês-calendário, criados + importados)", () => {
  it("conta pedido criado e importado uma vez só por id", () => {
    const c = new VolumeCounter(1000);
    c.record({ orderId: "a", source: "created", at: new Date("2026-11-05T10:00:00Z") });
    c.record({ orderId: "b", source: "imported", at: new Date("2026-11-06T10:00:00Z") });
    c.record({ orderId: "b", source: "imported", at: new Date("2026-11-06T10:00:00Z") }); // reimportação do mesmo lote
    expect(c.countFor("2026-11")).toBe(2);
  });
  it("mês novo zera a contagem", () => {
    const c = new VolumeCounter(1000);
    c.record({ orderId: "a", source: "created", at: new Date("2026-11-30T23:00:00-03:00") });
    c.record({ orderId: "b", source: "created", at: new Date("2026-12-01T01:00:00-03:00") });
    expect(c.countFor("2026-11")).toBe(1);
    expect(c.countFor("2026-12")).toBe(1);
  });
  it("alerta aos 80% e 100%, sem bloquear", () => {
    const c = new VolumeCounter(10);
    const levels: string[] = [];
    for (let i = 0; i < 11; i++) {
      const r = c.record({ orderId: `o${i}`, source: "created", at: new Date("2026-11-10T12:00:00Z") });
      expect(r.accepted).toBe(true); // nunca bloqueia
      if (r.alert) levels.push(r.alert);
    }
    expect(levels).toEqual(["80", "100"]);
  });
});
