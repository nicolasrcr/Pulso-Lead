import { normalizePhone } from "@pulso/domain";

export const PROVIDERS = ["payt", "braip", "b4you", "getenvios"] as const;
export type Provider = (typeof PROVIDERS)[number];
export type SalePayment = "pendente" | "pago" | "cancelado";

export interface CanonicalSale {
  eventId: string; externalOrderId: string; externalProductId: string;
  customer: { name: string; phone: string | null; email: string | null; cpf: string | null };
  affiliateEmail: string | null; totalCents: number; paymentStatus: SalePayment;
}

/**
 * ATENÇÃO: caminhos de campo PROVISÓRIOS. Os payloads reais de PayT/Braip/B4You/Get Envios ainda não foram
 * homologados (sem credenciais/contas). Ajustar aqui, com payload real em mãos, é a única mudança necessária.
 */
interface Spec { order: string; product: string; name: string; email: string; phone: string; cpf: string; aff: string; total: string; status: string; paid: string[]; canceled: string[] }
const SPECS: Record<Provider, Spec> = {
  braip: { order: "trans_key", product: "prod_key", name: "client_name", email: "client_email", phone: "client_cel", cpf: "client_documment", aff: "aff_email", total: "trans_value", status: "trans_status",
           paid: ["pagamento aprovado", "aprovado"], canceled: ["cancelada", "cancelado", "reembolsado", "chargeback"] },
  payt: { order: "transaction_id", product: "product.id", name: "customer.name", email: "customer.email", phone: "customer.phone", cpf: "customer.doc", aff: "affiliate.email", total: "amount", status: "status",
          paid: ["paid", "approved"], canceled: ["canceled", "cancelled", "refunded", "chargeback"] },
  b4you: { order: "id", product: "product_id", name: "customer.name", email: "customer.email", phone: "customer.phone", cpf: "customer.document", aff: "affiliate.email", total: "total", status: "status",
           paid: ["paid", "approved", "pago"], canceled: ["canceled", "cancelled", "refunded"] },
  getenvios: { order: "order_id", product: "product_id", name: "customer.name", email: "customer.email", phone: "customer.phone", cpf: "customer.cpf", aff: "affiliate_email", total: "total", status: "status",
               paid: ["paid", "pago"], canceled: ["canceled", "cancelado"] },
};

const dig = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const str = (v: unknown): string | null => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "" ? String(v).trim() : null;

/** Dinheiro sem float: "1.234,56" | "197.9" | 197.9 → centavos inteiros. */
export function toCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc > ld) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const [i = "0", f = ""] = s.split(".");
  if (!/^\d+$/.test(i) || (f && !/^\d+$/.test(f))) return null;
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
}

export function mapSale(provider: Provider, payload: unknown): CanonicalSale | null {
  const sp = SPECS[provider];
  if (!sp || !payload || typeof payload !== "object") return null;
  const order = str(dig(payload, sp.order)), product = str(dig(payload, sp.product));
  if (!order || !product) return null;
  const total = toCents(dig(payload, sp.total));
  if (total === null) return null;
  const raw = (str(dig(payload, sp.status)) ?? "").toLowerCase();
  const paymentStatus: SalePayment = sp.paid.includes(raw) ? "pago" : sp.canceled.includes(raw) ? "cancelado" : "pendente";
  const phone = str(dig(payload, sp.phone));
  return {
    eventId: `${order}:${paymentStatus}`, externalOrderId: order, externalProductId: product,
    customer: { name: str(dig(payload, sp.name)) ?? "Cliente sem nome", phone: phone ? normalizePhone(phone) : null,
                email: str(dig(payload, sp.email))?.toLowerCase() ?? null, cpf: str(dig(payload, sp.cpf)) },
    affiliateEmail: str(dig(payload, sp.aff))?.toLowerCase() ?? null, totalCents: total, paymentStatus,
  };
}
