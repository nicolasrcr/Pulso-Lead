export interface VolumeStatus { used: number; cap: number; pct: number; alert: "80" | "100" | null; over: boolean }
export interface VolumeMessage { level: "warning" | "danger"; text: string }

const nf = new Intl.NumberFormat("pt-BR");

/** Aviso do contador mensal (BLUEPRINT 3B.4). Informa, nunca bloqueia a operação. */
export function volumeMessage(v: VolumeStatus): VolumeMessage | null {
  if (v.cap <= 0 || !v.alert) return null;
  const base = `${nf.format(v.used)} de ${nf.format(v.cap)} pedidos no mês`;
  if (v.over) return { level: "danger", text: `${base}: ${nf.format(v.used - v.cap)} acima do teto do plano. A operação segue sem bloqueio; fale com o suporte para ajustar o plano.` };
  if (v.alert === "100") return { level: "danger", text: `${base}: teto do plano atingido. A operação segue sem bloqueio.` };
  return { level: "warning", text: `${base} (${v.pct}%): você está chegando ao teto do plano.` };
}
