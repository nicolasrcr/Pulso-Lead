export type PageKey = "painel" | "pedidos" | "catalogo" | "estoque" | "afiliados" | "integracoes" | "transportadora" | "webhooks" | "equipe" | "importar" | "exportar" | "backoffice";
export interface PageDef { key: PageKey; label: string }
interface Rule extends PageDef { anyOf?: string[]; needsProject: boolean; platformOnly?: boolean }

// Espelha as capabilities exigidas pela API (a API é quem decide; o menu só evita telas que dariam 403).
const RULES: Rule[] = [
  { key: "painel", label: "Painel", needsProject: true },
  { key: "pedidos", label: "Pedidos", anyOf: ["orders.read_all", "orders.create", "orders.edit", "dashboard.own"], needsProject: true },
  { key: "catalogo", label: "Catálogo", anyOf: ["products.manage"], needsProject: true },
  { key: "estoque", label: "Estoque", anyOf: ["products.manage", "orders.edit", "orders.read_all", "dashboard.full"], needsProject: true },
  { key: "afiliados", label: "Afiliados e comissões", anyOf: ["users.manage", "reports.read", "orders.read_all"], needsProject: true },
  { key: "integracoes", label: "Vendas externas", anyOf: ["users.manage", "products.manage"], needsProject: true },
  { key: "transportadora", label: "Transportadora", anyOf: ["users.manage"], needsProject: true },
  { key: "webhooks", label: "Webhooks", anyOf: ["users.manage"], needsProject: true },
  { key: "equipe", label: "Equipe", anyOf: ["users.manage"], needsProject: true },
  { key: "importar", label: "Importar pedidos", anyOf: ["orders.edit", "orders.create"], needsProject: true },
  { key: "exportar", label: "Exportar dados", anyOf: ["orders.read_all", "reports.read"], needsProject: true },
  { key: "backoffice", label: "Back-office", needsProject: false, platformOnly: true },
];

export function visiblePages(o: { capabilities: string[]; platformAdmin: boolean; hasProject: boolean }): PageDef[] {
  return RULES.filter((r) => {
    if (r.platformOnly) return o.platformAdmin;
    if (r.needsProject && !o.hasProject) return false;
    return !r.anyOf || r.anyOf.some((c) => o.capabilities.includes(c));
  }).map(({ key, label }) => ({ key, label }));
}
