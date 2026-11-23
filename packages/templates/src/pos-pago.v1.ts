import type { ActivityTemplate, StatusDef, Category } from "./types";

const s = (key: string, label: string, category: Category): StatusDef => ({ key, label, category });

// Eixo de envio: chaves idênticas às de @pulso/domain (SHIPPING_STATUSES). A máquina de estados fica no domínio.
const shipping: StatusDef[] = [
  s("sem_status", "Sem Status", "initial"), s("preparando_logistica", "Preparando logística", "in_progress"),
  s("preparando", "Preparando", "in_progress"), s("aguardando_coleta", "Aguardando coleta", "in_progress"),
  s("coletado", "Coletado", "in_progress"), s("enviado", "Enviado", "in_progress"),
  s("em_transito", "Em trânsito", "in_progress"), s("rota_entrega", "Rota de Entrega", "in_progress"),
  s("entregue", "Entregue", "success"), s("entregue_caixa", "Entregue em caixas inteligentes", "success"),
  s("nao_entregue", "Não entregue", "failure"), s("entrega_falhou", "Entrega falhou", "failure"),
  s("pronto_retirada", "Pronto p/ retirada", "in_progress"), s("retornando", "Retornando", "failure"),
  s("devolvido", "Devolvido", "failure"), s("retornado_reverso", "Retornado com Reverso", "failure"),
  s("reverso_gerado", "Reverso Gerado", "in_progress"), s("reverso_pendente", "Reverso pendente", "in_progress"),
  s("reenviado", "Reenviado", "in_progress"), s("avariado", "Avariado", "failure"),
  s("bloqueado", "Bloqueado", "failure"), s("apreendido", "Apreendido", "failure"),
  s("perdido", "Perdido", "failure"), s("roubado", "Roubado", "failure"),
  s("atrasado", "Atrasado", "in_progress"), s("endereco_incompleto", "Endereço incompleto", "failure"),
  s("em_analise", "Em análise", "in_progress"), s("desconhecido", "Desconhecido", "in_progress"),
  s("cancelado", "Cancelado", "cancelled"), s("etiqueta_cancelada", "Etiqueta Expirada/Cancelada", "cancelled"),
];

export const posPagoV1: ActivityTemplate = {
  key: "pos-pago",
  version: 1,
  label: "Pós-pago (pagamento na entrega)",
  defaults: { overdueGraceDays: 15 },
  axes: {
    platform: {
      statuses: [
        s("sem_status", "Sem Status", "initial"), s("em_analise", "Em Análise", "in_progress"),
        s("criado", "Criado", "initial"), s("cobrado", "Cobrado", "in_progress"),
        s("inadimplente", "Inadimplente", "failure"), s("concluido", "Concluído", "success"),
        s("frustrado", "Frustrado", "failure"), s("roubo", "Roubo", "failure"),
        s("cancelado", "Cancelado", "cancelled"), s("cancelado_sem_custo", "Cancelado sem Custo", "cancelled"),
        s("cancelado_com_custo", "Cancelado com Custo", "cancelled"), s("devolucao_concluida", "Devolução Concluída", "failure"),
      ],
      transitions: [
        { from: "criado", to: "em_analise" }, { from: "em_analise", to: "cobrado" },
        { from: "criado", to: "cobrado" }, { from: "cobrado", to: "concluido" },
        { from: "cobrado", to: "inadimplente" }, { from: "inadimplente", to: "concluido" },
        { from: "inadimplente", to: "frustrado" },
        { from: "criado", to: "cancelado_sem_custo" }, { from: "em_analise", to: "cancelado_sem_custo" },
        { from: "cobrado", to: "cancelado_com_custo" }, { from: "cobrado", to: "roubo" },
        { from: "cobrado", to: "devolucao_concluida" }, { from: "inadimplente", to: "devolucao_concluida" },
      ],
    },
    shipping: { statuses: shipping, transitions: [] }, // transições vivem em @pulso/domain
    payment: {
      statuses: [
        s("sem_status", "Sem Status", "initial"), s("pendente", "Pagamento Pendente", "in_progress"),
        s("parcial", "Pagamento Parcial", "in_progress"), s("pago", "Pago", "success"),
        s("recusado", "Pagamento Recusado", "failure"), s("expirado", "Expirado", "failure"),
      ],
      transitions: [
        { from: "sem_status", to: "pendente" }, { from: "pendente", to: "pago" },
        { from: "pendente", to: "parcial" }, { from: "parcial", to: "pago" },
        { from: "pendente", to: "recusado" }, { from: "pendente", to: "expirado" },
      ],
    },
  },
  // Kanban derivado: o bucket é calculado a partir dos três eixos, nunca armazenado (proposta [PROP]).
  kanban: [
    { key: "agendados", label: "Agendados", match: ["shipping:sem_status"] },
    { key: "aguardando_pagamento", label: "Aguardando Pagamento", match: ["payment:pendente"] },
    { key: "enviados", label: "Enviados", match: ["shipping:enviado", "shipping:em_transito", "shipping:coletado"] },
    { key: "saiu_entrega", label: "Saiu para Entrega", match: ["shipping:rota_entrega"] },
    { key: "retirar", label: "Retirar nos Correios", match: ["shipping:pronto_retirada"] },
    { key: "requer_atencao", label: "Requer Atenção", match: ["shipping:avariado", "shipping:bloqueado", "shipping:endereco_incompleto", "shipping:nao_entregue"] },
    { key: "entregues", label: "Entregues", match: ["shipping:entregue", "shipping:entregue_caixa"] },
    { key: "inadimplencias", label: "Inadimplências", match: ["platform:inadimplente"] },
    { key: "frustrados", label: "Frustrados", match: ["platform:frustrado"] },
    { key: "pagos", label: "Pagos", match: ["payment:pago"] },
  ],
};
