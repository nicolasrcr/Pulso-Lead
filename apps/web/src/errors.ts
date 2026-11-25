import { ApiError } from "./api";

const BY_CODE: Record<string, string> = {
  organization_suspended: "Organização suspensa: somente leitura. Procure o fornecedor.",
  insufficient_stock: "Estoque insuficiente para liberar este pedido.",
  stale_state: "O pedido mudou enquanto você olhava. Atualize e tente de novo.",
  invalid_transition: "Essa mudança de status não é permitida.",
  already_shipped: "Este pedido já tem etiqueta.",
  no_carrier: "Nenhuma transportadora ativa configurada.",
  carrier_rejected: "A transportadora recusou o envio. Confira NF, CEP, documento e peso.",
  no_tracking: "O pedido ainda não tem código de rastreio.",
  conflict: "Já existe um registro igual.",
  invalid_url: "URL inválida: use https e um endereço público.",
};
const BY_STATUS: Record<number, string> = {
  400: "Dados inválidos. Revise os campos.", 401: "Sessão expirada. Entre de novo.", 403: "Sem permissão para esta ação.",
  404: "Não encontrado.", 409: "Conflito com o estado atual.", 423: "Organização suspensa: somente leitura.", 429: "Muitas tentativas. Aguarde um minuto.",
};
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return BY_CODE[e.code] ?? BY_STATUS[e.status] ?? (e.status >= 500 ? "Erro no servidor. Tente novamente." : "Não foi possível concluir.");
  return "Falha de conexão.";
}
