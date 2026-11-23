import { describe, it, expect } from "vitest";
import type { CarrierAdapter } from "./carrier";
import { SHIPPING_STATUSES } from "./shipping-state";

const addr = { zip: "70040010", uf: "DF" };
const parcel = { weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 };

/** Suíte reutilizável: toda transportadora (J&T incluída, em sandbox) deve passar sem mudar o domínio. */
export function runCarrierContract(name: string, make: () => CarrierAdapter): void {
  describe(`contrato ${name}`, () => {
    it("cota em centavos inteiros e prazo positivo", async () => {
      const q = await make().quote({ origin: addr, destination: addr, parcel });
      expect(Number.isInteger(q.priceCents)).toBe(true);
      expect(q.priceCents).toBeGreaterThan(0);
      expect(q.etaDays).toBeGreaterThan(0);
    });
    it("gera etiqueta com código de rastreio e URL", async () => {
      const s = await make().createShipment({ orderId: "o1", destination: addr, parcel, recipientName: "Fulano" });
      expect(s.trackingCode).toBeTruthy();
      expect(s.labelUrl).toMatch(/^https:\/\//);
    });
    it("cancela uma vez; o segundo cancelamento não repete", async () => {
      const c = make();
      const s = await c.createShipment({ orderId: "o2", destination: addr, parcel, recipientName: "Fulano" });
      expect((await c.cancel(s.trackingCode)).cancelled).toBe(true);
      expect((await c.cancel(s.trackingCode)).cancelled).toBe(false);
    });
    it("normaliza eventos para o status canônico, nunca para código nativo", () => {
      const ev = make().normalizeEvent({ code: "QUALQUER_CODIGO_NATIVO", occurredAt: new Date(), trackingCode: "X" });
      expect(SHIPPING_STATUSES).toContain(ev.status);
    });
  });
}
