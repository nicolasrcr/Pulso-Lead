import type { CarrierEvent, ShippingStatus } from "@pulso/domain";

/**
 * Mapa código/descrição de scan J&T → status canônico.
 * ATENÇÃO: derivado de nomenclatura pública de scans; NÃO homologado com a conta real
 * (trackingQuery só funciona em produção). Códigos desconhecidos viram "desconhecido".
 */
const MAP: Record<string, ShippingStatus> = {
  "COLETA": "coletado", "PICKUP": "coletado", "COLLECTED": "coletado", "COLETADO": "coletado",
  "AGUARDANDO COLETA": "aguardando_coleta", "ORDER_CREATED": "aguardando_coleta",
  "EM TRANSITO": "em_transito", "TRANSIT": "em_transito", "ARRIVAL": "em_transito", "DEPARTURE": "em_transito",
  "SAIDA PARA ENTREGA": "rota_entrega", "OUT_FOR_DELIVERY": "rota_entrega", "DELIVERING": "rota_entrega",
  "ENTREGUE": "entregue", "DELIVERED": "entregue", "SIGNED": "entregue",
  "ENTREGA NAO REALIZADA": "nao_entregue", "DELIVERY_FAILED": "entrega_falhou", "PROBLEMATIC": "entrega_falhou",
  "DEVOLUCAO": "retornando", "RETURNING": "retornando", "DEVOLVIDO": "devolvido", "RETURNED": "devolvido",
  "EXTRAVIADO": "perdido", "LOST": "perdido", "AVARIA": "avariado", "DAMAGED": "avariado",
  "CANCELADO": "cancelado", "CANCELLED": "cancelado",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

export function normalizeJtEvent(raw: { code: string; occurredAt: Date; trackingCode: string }): CarrierEvent {
  return { trackingCode: raw.trackingCode, status: MAP[norm(raw.code)] ?? "desconhecido", occurredAt: raw.occurredAt, rawCode: raw.code };
}
