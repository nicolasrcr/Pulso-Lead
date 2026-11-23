export const SHIPPING_STATUSES = [
  "sem_status", "preparando_logistica", "preparando", "aguardando_coleta", "coletado",
  "enviado", "em_transito", "rota_entrega", "entregue", "entregue_caixa", "nao_entregue",
  "entrega_falhou", "pronto_retirada", "retornando", "devolvido", "retornado_reverso",
  "reverso_gerado", "reverso_pendente", "reenviado",
  "avariado", "bloqueado", "apreendido", "perdido", "roubado", "atrasado",
  "endereco_incompleto", "em_analise", "desconhecido", "cancelado", "etiqueta_cancelada",
] as const;
export type ShippingStatus = (typeof SHIPPING_STATUSES)[number];

export const TERMINAL: ReadonlySet<ShippingStatus> = new Set([
  "entregue", "entregue_caixa", "devolvido", "retornado_reverso", "perdido", "roubado",
  "cancelado", "etiqueta_cancelada", "apreendido",
]);

/** Excepcionais alcançáveis de qualquer estado não terminal. */
const EXCEPTIONAL: ReadonlySet<ShippingStatus> = new Set([
  "avariado", "bloqueado", "apreendido", "perdido", "roubado", "atrasado",
  "endereco_incompleto", "em_analise", "desconhecido", "reenviado", "cancelado", "etiqueta_cancelada",
]);
/** Excepcionais que não encerram o ciclo: podem voltar ao fluxo. */
const RECOVERABLE: ReadonlySet<ShippingStatus> = new Set([
  "avariado", "bloqueado", "atrasado", "endereco_incompleto", "em_analise", "desconhecido", "reenviado",
]);

const FLOW: Partial<Record<ShippingStatus, ShippingStatus[]>> = {
  sem_status: ["preparando_logistica"],
  preparando_logistica: ["preparando", "aguardando_coleta"],
  preparando: ["aguardando_coleta"],
  aguardando_coleta: ["coletado"],
  coletado: ["enviado", "em_transito"],
  enviado: ["em_transito"],
  em_transito: ["rota_entrega", "retornando"],
  rota_entrega: ["entregue", "entregue_caixa", "nao_entregue", "entrega_falhou", "pronto_retirada"],
  nao_entregue: ["rota_entrega", "retornando", "pronto_retirada"],
  entrega_falhou: ["rota_entrega", "retornando"],
  pronto_retirada: ["entregue", "retornando"],
  retornando: ["devolvido", "retornado_reverso", "reverso_gerado", "reverso_pendente"],
  reverso_gerado: ["retornado_reverso"],
  reverso_pendente: ["reverso_gerado", "retornado_reverso"],
};
const RECOVERY_TARGETS: ShippingStatus[] = ["em_transito", "rota_entrega", "retornando", "pronto_retirada"];

export function isTerminal(s: ShippingStatus): boolean {
  return TERMINAL.has(s);
}

export function canTransition(from: ShippingStatus, to: ShippingStatus): boolean {
  if (from === to || isTerminal(from)) return false;
  if (EXCEPTIONAL.has(to)) return true;
  if (RECOVERABLE.has(from)) return RECOVERY_TARGETS.includes(to);
  return FLOW[from]?.includes(to) ?? false;
}

export interface ShippingState { status: ShippingStatus; lastEventAt: Date | null }
export interface ShippingEvent { status: ShippingStatus; occurredAt: Date }
export interface ApplyResult {
  applied: boolean;
  reason?: "stale" | "invalid_transition";
  state: ShippingState;
}

/** Aplica evento de transporte. Evento mais antigo que o último nunca regride o estado. */
export function applyShippingEvent(state: ShippingState, ev: ShippingEvent): ApplyResult {
  if (state.lastEventAt && ev.occurredAt.getTime() < state.lastEventAt.getTime()) {
    return { applied: false, reason: "stale", state };
  }
  if (!canTransition(state.status, ev.status)) {
    return { applied: false, reason: "invalid_transition", state };
  }
  return { applied: true, state: { status: ev.status, lastEventAt: ev.occurredAt } };
}

export interface ReopenAudit { from: ShippingStatus; to: ShippingStatus; actorId: string; reason: string; at: Date }

/** Reabrir terminal é ação manual auditada: exige ator e motivo. */
export function reopenTerminal(
  state: ShippingState,
  to: ShippingStatus,
  by: { actorId: string; reason: string },
  at: Date = new Date(),
): { state: ShippingState; audit: ReopenAudit } {
  if (!by.actorId.trim() || !by.reason.trim()) throw new Error("reabertura exige actorId e motivo");
  if (!isTerminal(state.status)) throw new Error("só estados terminais são reabertos manualmente");
  return {
    state: { status: to, lastEventAt: at },
    audit: { from: state.status, to, actorId: by.actorId, reason: by.reason, at },
  };
}
