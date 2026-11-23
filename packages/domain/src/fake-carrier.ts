import type { CarrierAdapter, CarrierEvent, Quote, Shipment } from "./carrier";

export class FakeCarrierAdapter implements CarrierAdapter {
  readonly key = "fake";
  private shipments = new Map<string, { cancelled: boolean }>();
  async quote(): Promise<Quote> { return { carrierKey: this.key, priceCents: 1_890, etaDays: 4 }; }
  async createShipment(i: { orderId: string }): Promise<Shipment> {
    const trackingCode = `FAKE${i.orderId}`;
    this.shipments.set(trackingCode, { cancelled: false });
    return { trackingCode, labelUrl: `https://example.invalid/label/${trackingCode}.pdf` };
  }
  async cancel(code: string) {
    const s = this.shipments.get(code);
    if (!s || s.cancelled) return { cancelled: false };
    s.cancelled = true;
    return { cancelled: true };
  }
  async track(code: string): Promise<CarrierEvent[]> {
    return [this.normalizeEvent({ code: "COLLECTED", occurredAt: new Date("2026-11-01T10:00:00Z"), trackingCode: code })];
  }
  normalizeEvent(raw: { code: string; occurredAt: Date; trackingCode: string }): CarrierEvent {
    const map: Record<string, CarrierEvent["status"]> = { COLLECTED: "coletado", DELIVERED: "entregue" };
    return { trackingCode: raw.trackingCode, status: map[raw.code] ?? "desconhecido", occurredAt: raw.occurredAt, rawCode: raw.code };
  }
}
