import type { CarrierAdapter, CarrierEvent, Quote, QuoteInput, Shipment, ShipmentInput } from "@pulso/domain";
import { headerDigest, businessDigest, type JtCredentials } from "./digest";
import { buildAddOrder, buildCancel, type JtSender } from "./payload";
import { normalizeJtEvent } from "./events";

export const JT_HOSTS = { homolog: "https://demoopenapi.jtjms-br.com", production: "https://openapi.jtjms-br.com" } as const;

/** addOrder é o único path confirmado em homologação real; os demais são NÃO HOMOLOGADOS e sobrescrevíveis. */
export const JT_PATHS = {
  addOrder: "/webopenplatformapi/api/order/addOrder",
  cancelOrder: "/webopenplatformapi/api/order/cancelOrder",
  checkFreight: "/webopenplatformapi/api/order/checkFreight",
  trackingQuery: "/webopenplatformapi/api/logistics/trace",
};

export interface JtRequest { url: string; headers: Record<string, string>; body: string }
export interface JtResponse { status: number; json: unknown }
export type JtTransport = (req: JtRequest) => Promise<JtResponse>;

export class JtApiError extends Error {
  constructor(public readonly code: string, message: string) { super(`J&T ${code}: ${message}`); }
}

export interface JtAdapterOptions {
  credentials: JtCredentials;
  sender: JtSender;
  env: keyof typeof JT_HOSTS;
  transport: JtTransport;
  /** Base pública onde a plataforma serve a etiqueta (PDF). */
  labelBaseUrl: string;
  txPrefix?: string;
  paths?: Partial<typeof JT_PATHS>;
  /** Resolve txlogisticId a partir do billCode (persistido em shipments). Fallback: cache em memória. */
  resolveTxId?: (trackingCode: string) => Promise<string | undefined>;
  now?: () => number;
}

export const fetchTransport: JtTransport = async (req) => {
  const r = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, redirect: "manual" });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

type Obj = Record<string, any>;

export class JtAdapter implements CarrierAdapter {
  readonly key = "jt";
  private tx = new Map<string, string>();
  private cancelled = new Set<string>();
  constructor(private readonly o: JtAdapterOptions) {}

  private async call(path: string, payload: Obj): Promise<Obj> {
    const bizContent = JSON.stringify(payload); // serializa UMA vez
    const res = await this.o.transport({
      url: `${JT_HOSTS[this.o.env]}${path}`,
      headers: {
        apiAccount: this.o.credentials.apiAccount,
        digest: headerDigest(bizContent, this.o.credentials.privateKey),
        timestamp: String((this.o.now ?? Date.now)()),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ bizContent }).toString(),
    });
    const j = (res.json ?? {}) as Obj;
    if (res.status >= 400 || String(j.code) !== "1") throw new JtApiError(String(j.code ?? res.status), String(j.msg ?? "falha"));
    return j;
  }

  async quote(i: QuoteInput): Promise<Quote> {
    const j = await this.call(this.o.paths?.checkFreight ?? JT_PATHS.checkFreight, {
      customerCode: this.o.credentials.customerCode, digest: businessDigest(this.o.credentials),
      sendSite: i.origin.zip.replace(/\D/g, ""), destAreaCode: i.destination.zip.replace(/\D/g, ""),
      weight: String(i.parcel.weightGrams / 1000),
    });
    const d = (j.data ?? {}) as Obj;
    return { carrierKey: this.key, priceCents: Math.round(Number(d.freight) * 100), etaDays: Number(d.days ?? d.eta) };
  }

  async createShipment(i: ShipmentInput): Promise<Shipment> {
    const txlogisticId = `${this.o.txPrefix ?? "PL-"}${i.orderId}`;
    const j = await this.call(this.o.paths?.addOrder ?? JT_PATHS.addOrder, buildAddOrder(this.o.credentials, this.o.sender, i, txlogisticId));
    const code = j.data?.orderList?.[0]?.billCode as string | undefined;
    if (!code) throw new JtApiError("sem_billcode", "resposta sem billCode");
    this.tx.set(code, txlogisticId);
    return { trackingCode: code, labelUrl: `${this.o.labelBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(code)}.pdf` };
  }

  async cancel(trackingCode: string): Promise<{ cancelled: boolean }> {
    if (this.cancelled.has(trackingCode)) return { cancelled: false };
    const txId = this.tx.get(trackingCode) ?? (await this.o.resolveTxId?.(trackingCode));
    if (!txId) throw new JtApiError("sem_txlogisticId", `pedido não conhecido para ${trackingCode}`);
    await this.call(this.o.paths?.cancelOrder ?? JT_PATHS.cancelOrder, buildCancel(this.o.credentials, txId, "cancelado pela plataforma"));
    this.cancelled.add(trackingCode);
    return { cancelled: true };
  }

  async track(trackingCode: string): Promise<CarrierEvent[]> {
    const j = await this.call(this.o.paths?.trackingQuery ?? JT_PATHS.trackingQuery, {
      billCodes: trackingCode, customerCode: this.o.credentials.customerCode, digest: businessDigest(this.o.credentials),
    });
    const list = (j.data?.[0]?.details ?? j.data?.details ?? []) as Obj[];
    return list
      .map((d) => this.normalizeEvent({ code: String(d.scanType ?? d.status ?? ""), occurredAt: new Date(String(d.scanTime).replace(" ", "T") + "-03:00"), trackingCode }))
      .filter((e) => !Number.isNaN(e.occurredAt.getTime()))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  normalizeEvent(raw: { code: string; occurredAt: Date; trackingCode: string }): CarrierEvent { return normalizeJtEvent(raw); }
}
