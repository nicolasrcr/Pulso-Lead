// RBAC: capabilities atômicas + 9 presets (grupos da referência). Checagem sempre no servidor; a UI só esconde.
export const CAPABILITIES = [
  "orders.create", "orders.read_all", "orders.edit", "orders.status.own_after_delivery", "orders.status.all",
  "billing.status", "notes.create", "notes.read", "reports.read", "dashboard.full", "dashboard.own",
  "products.manage", "products.private.read", "users.manage", "checkout_links.read",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type Role = "org_admin" | "project_admin" | "operator" | "affiliate";

export const PRESETS: Record<string, Capability[]> = {
  interno: ["dashboard.full", "orders.edit", "orders.create", "orders.read_all", "orders.status.own_after_delivery"],
  gestor_pedidos: ["notes.create", "notes.read", "dashboard.own", "orders.status.own_after_delivery"],
  checkout_produtor: ["checkout_links.read"],
  mentorado_atendente: ["notes.create", "notes.read", "dashboard.own", "orders.create", "orders.status.own_after_delivery"],
  administrador_produtor: ["products.manage", "dashboard.full", "reports.read", "users.manage", "orders.edit", "orders.read_all", "orders.create", "checkout_links.read"],
  // "Apenas Produtos Privados" restringe a visão a esse recorte; a restrição é de consulta, não uma capability distinta.
  produtos_privados: ["products.private.read"],
  apenas_produtos_privados: ["products.private.read"],
  cobranca_master: ["orders.status.all", "billing.status", "notes.create", "notes.read", "orders.read_all", "orders.edit", "reports.read"],
  cobranca: ["notes.create", "notes.read", "reports.read", "orders.status.own_after_delivery", "billing.status", "dashboard.own"],
};

export interface Grantee { role: Role; capabilities: readonly string[]; platformAdmin?: boolean }

const KNOWN: ReadonlySet<string> = new Set(CAPABILITIES);

/** Conjunto efetivo: admins têm tudo; os demais, só capabilities conhecidas que foram concedidas. */
export function effectiveCapabilities(m: Grantee): Capability[] {
  if (m.platformAdmin || m.role === "org_admin" || m.role === "project_admin") return [...CAPABILITIES];
  return [...new Set(m.capabilities)].filter((c): c is Capability => KNOWN.has(c));
}

export function can(m: Grantee, cap: Capability): boolean {
  return effectiveCapabilities(m).includes(cap);
}

const RANK: Record<Role, number> = { affiliate: 0, operator: 1, project_admin: 2, org_admin: 3 };

/** Anti-escalada: só concede papel estritamente abaixo do próprio e capabilities que já possui. */
export function canGrant(grantor: Grantee, target: { role: Role; capabilities: readonly string[] }): boolean {
  if (grantor.platformAdmin || grantor.role === "org_admin") return true;
  if (grantor.role !== "project_admin") return false;
  if (RANK[target.role] >= RANK[grantor.role]) return false;
  const mine = new Set<string>(effectiveCapabilities(grantor));
  return target.capabilities.every((c) => mine.has(c));
}
