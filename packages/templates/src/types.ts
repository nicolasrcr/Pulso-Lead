export type Category = "initial" | "in_progress" | "success" | "failure" | "cancelled";
export interface StatusDef { key: string; label: string; category: Category }
export interface Transition { from: string; to: string }
export interface Axis { statuses: StatusDef[]; transitions: Transition[] }
export interface KanbanBucket { key: string; label: string; match: string[] } // "eixo:status"
export interface ActivityTemplate {
  key: string;
  version: number;
  label: string;
  axes: { platform: Axis; shipping: Axis; payment: Axis };
  kanban: KanbanBucket[];
  defaults: { overdueGraceDays: number };
}

/** Retorna a lista de problemas; vazia = template válido. */
export function validateTemplate(t: ActivityTemplate): string[] {
  const errs: string[] = [];
  for (const [name, axis] of Object.entries(t.axes)) {
    const keys = new Set(axis.statuses.map((s) => s.key));
    if (keys.size !== axis.statuses.length) errs.push(`${name}: status duplicado`);
    for (const tr of axis.transitions) {
      if (!keys.has(tr.from)) errs.push(`${name}: transição de status inexistente ${tr.from}`);
      if (!keys.has(tr.to)) errs.push(`${name}: transição para status inexistente ${tr.to}`);
    }
  }
  return errs;
}

/** O bucket é calculado a partir dos três eixos (nunca armazenado). Um pedido pode estar em mais de um. */
export function deriveBuckets(
  t: ActivityTemplate,
  s: { platform: string; shipping: string; payment: string },
): string[] {
  const refs = new Set([`platform:${s.platform}`, `shipping:${s.shipping}`, `payment:${s.payment}`]);
  return t.kanban.filter((b) => b.match.some((m) => refs.has(m))).map((b) => b.key);
}

/** Transições dos eixos de plataforma e pagamento vêm do template (dados). O envio é do domínio (@pulso/domain). */
export function canTransitionAxis(t: ActivityTemplate, axis: "platform" | "payment" | "shipping", from: string, to: string): boolean {
  if (axis === "shipping") throw new Error("o eixo de envio é validado por @pulso/domain (canTransition)");
  return t.axes[axis].transitions.some((x) => x.from === from && x.to === to);
}
