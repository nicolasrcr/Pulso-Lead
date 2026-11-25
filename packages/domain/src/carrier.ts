import type { ShippingStatus } from "./shipping-state";

export interface Address { zip: string; uf: string; city?: string; street?: string; number?: string; district?: string; complement?: string }
export interface Parcel { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number }
export interface QuoteInput { origin: Address; destination: Address; parcel: Parcel }
export interface Quote { carrierKey: string; priceCents: number; etaDays: number }
export interface ShipmentItem { name: string; quantity: number; unitCents: number; ncm?: string }
export interface ShipmentInvoice { number: string; series: string; accessKey: string; issuedAt: string; issuerTaxId: string }
export interface ShipmentInput {
  orderId: string; destination: Address; parcel: Parcel; recipientName: string;
  /** Exigidos por transportadoras que emitem etiqueta com NF (J&T). Opcionais para o contrato mínimo. */
  recipientDocument?: string; recipientPhone?: string;
  items?: ShipmentItem[]; totalCents?: number; invoice?: ShipmentInvoice;
}
export interface Shipment { trackingCode: string; labelUrl: string }
export interface CarrierEvent { trackingCode: string; status: ShippingStatus; occurredAt: Date; rawCode: string }

/** Contrato único. A J&T é a primeira implementação; outras transportadoras entram sem mexer na máquina de estados. */
export interface CarrierAdapter {
  readonly key: string;
  quote(input: QuoteInput): Promise<Quote>;
  createShipment(input: ShipmentInput): Promise<Shipment>;
  cancel(trackingCode: string): Promise<{ cancelled: boolean }>;
  track(trackingCode: string): Promise<CarrierEvent[]>;
  /** Traduz o código nativo da transportadora para o status canônico. Nunca vaza código nativo para o domínio. */
  normalizeEvent(raw: { code: string; occurredAt: Date; trackingCode: string }): CarrierEvent;
}
