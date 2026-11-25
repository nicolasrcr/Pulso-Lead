import type { VolumeStatus } from "./volume";
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(`${status} ${code}`); }
}
export interface TokenStore { get(): string | null; set(v: string | null): void }
export interface ApiOptions { baseUrl: string; fetch?: typeof fetch; store: TokenStore; onUnauthorized?: () => void }

export interface Me {
  user: { id: string; email: string; name: string; platformAdmin: boolean };
  memberships: { id: string; organizationId: string; projectId: string | null; role: string; status: "pending" | "approved"; capabilities: string[] }[];
  projects: { id: string; organizationId: string; name: string }[];
  capabilities: Record<string, string[]>;
}

export interface DashSummary {
  orders: number; grossCents: number; paid: number; paidCents: number; delivered: number; lost: number; returned: number; overdue: number;
  rates: { conversionBps: number; deliveryBps: number; returnBps: number; lossBps: number; overdueBps: number };
}
export interface Dashboard {
  range: { from: string; to: string }; scope: "project" | "all"; anyStale: boolean; total: DashSummary;
  byProject: (DashSummary & { projectId: string; name: string; refreshedAt: string | null; stale: boolean })[];
}

export function createApiClient(o: ApiOptions) {
  const doFetch = o.fetch ?? fetch;
  let projectId: string | null = null;

  async function raw(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = o.store.get();
    if (token) headers.authorization = `Bearer ${token}`;
    if (projectId) headers["x-project-id"] = projectId;
    const res = await doFetch(`${o.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) { o.store.set(null); o.onUnauthorized?.(); }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, data.error ?? "error");
    }
    return res;
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await raw(method, path, body);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  const q = (o2: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries(o2).filter(([, v]) => v !== undefined) as [string, string][]).toString();
    return p ? `?${p}` : "";
  };
  return {
    selectProject(id: string | null) { projectId = id; },
    get selectedProject() { return projectId; },
    async login(email: string, password: string) {
      const r = await call<{ token: string; expiresAt: string }>("POST", "/v1/auth/login", { email, password });
      o.store.set(r.token);
      return r;
    },
    async logout() { await call("POST", "/v1/auth/logout"); o.store.set(null); },
    register: (email: string, name: string, password: string) => call<{ id: string }>("POST", "/v1/auth/register", { email, name, password }),
    me: () => call<Me>("GET", "/v1/me"),
    projects: () => call<{ projects: { id: string; name: string }[] }>("GET", "/v1/projects"),
    dashboard: () => call<Dashboard>("GET", "/v1/dashboard"),
    refreshDashboard: () => call<{ rows: number }>("POST", "/v1/dashboard/refresh"),
    kanban: () => call<{ buckets: { key: string; label: string; count: number }[] }>("GET", "/v1/kanban"),
    volume: () => call<VolumeStatus>("GET", "/v1/volume"),
    createProject: (organizationId: string, name: string) => call<{ id: string }>("POST", "/v1/projects", { organizationId, name }),

    // Download autenticado (CSV): o navegador não envia o Bearer em <a href>, então buscamos o texto e geramos o arquivo no cliente.
    async download(path: string): Promise<{ filename: string; text: string }> {
      const res = await raw("GET", path);
      const m = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
      return { filename: m?.[1] ?? "export.csv", text: await res.text() };
    },

    // Pedidos
    orders: (cursor?: string) => call<{ orders: OrderRow[]; nextCursor: string | null }>("GET", `/v1/orders${q({ cursor })}`),
    order: (id: string) => call<OrderDetail>("GET", `/v1/orders/${id}`),
    createOrder: (b: { planId: string; affiliateId?: string; totalCents?: number; afterPay?: boolean; customer: { name: string; cpf?: string; phone?: string; email?: string; address?: Record<string, string> } }) =>
      call<{ id: string; created: boolean }>("POST", "/v1/orders", b),
    releaseOrder: (id: string) => call<unknown>("POST", `/v1/orders/${id}/release`),
    transition: (id: string, axis: "platform" | "payment", from: string, to: string) => call<{ ok: boolean }>("POST", `/v1/orders/${id}/transition`, { axis, from, to }),
    returnOrder: (id: string, disposition: "returned" | "discarded", reason?: string) => call<unknown>("POST", `/v1/orders/${id}/return`, { disposition, reason }),
    revealCpf: (id: string) => call<{ cpf: string }>("POST", `/v1/orders/${id}/reveal-cpf`),
    setTracking: (id: string, code: string) => call<{ ok: boolean }>("POST", `/v1/orders/${id}/tracking`, { code }),
    resendTracking: (id: string) => call<{ ok: boolean }>("POST", `/v1/orders/${id}/tracking/resend`),
    createShipment: (id: string, b: unknown) => call<{ trackingCode: string; labelUrl: string }>("POST", `/v1/orders/${id}/shipment`, b),
    runOverdue: () => call<unknown>("POST", "/v1/overdue/run"),

    // Catálogo e estoque
    products: () => call<{ products: Product[]; plans: Plan[] }>("GET", "/v1/products"),
    createProduct: (name: string, sku?: string) => call<{ id: string }>("POST", "/v1/products", { name, sku }),
    createPlan: (productId: string, b: { name: string; priceCents: number; commissionRule: unknown; bom: { stockItemId: string; qty: number }[] }) => call<{ id: string }>("POST", `/v1/products/${productId}/plans`, b),
    stockItems: () => call<{ items: StockItem[] }>("GET", "/v1/stock-items"),
    createStockItem: (b: { sku: string; name: string; quantity: number; minQuantity: number }) => call<{ id: string }>("POST", "/v1/stock-items", b),
    adjustStock: (id: string, delta: number, reason: "adjust" | "purchase" | "loss") => call<{ quantity: number }>("POST", `/v1/stock-items/${id}/adjust`, { delta, reason }),
    stockMovements: (id: string) => call<{ movements: StockMovement[] }>("GET", `/v1/stock-items/${id}/movements`),

    // Afiliados e comissões
    affiliates: () => call<{ affiliates: { id: string; name: string; active: boolean }[] }>("GET", "/v1/affiliates"),
    createAffiliate: (name: string) => call<{ id: string }>("POST", "/v1/affiliates", { name }),
    affiliateLink: (id: string, planId?: string) => call<{ token: string }>("GET", `/v1/affiliates/${id}/link${q({ planId })}`),
    commissions: () => call<{ affiliates: { affiliateId: string; name: string; accruedCents: number; reversedCents: number; balanceCents: number }[] }>("GET", "/v1/commissions"),

    // Vendas externas
    connectors: () => call<{ connectors: { id: string; provider: string; active: boolean; createdAt: string }[] }>("GET", "/v1/connectors"),
    createConnector: (provider: string) => call<{ id: string; provider: string; path: string; secret: string }>("POST", "/v1/connectors", { provider }),
    createProductLink: (provider: string, externalProductId: string, planId: string) => call<{ id: string }>("POST", "/v1/product-links", { provider, externalProductId, planId }),
    createAffiliateEmailLink: (provider: string, email: string, affiliateId: string) => call<{ id: string }>("POST", "/v1/affiliate-email-links", { provider, email, affiliateId }),
    salesEvents: (status?: string) => call<{ events: SalesEvent[] }>("GET", `/v1/sales-events${q({ status })}`),
    reprocessSales: () => call<{ reprocessed: number; outcomes: Record<string, number> }>("POST", "/v1/sales-events/reprocess"),

    // Transportadora
    carriers: () => call<{ carriers: { id: string; carrierKey: string; enabled: boolean; isDefault: boolean }[] }>("GET", "/v1/carriers"),
    createCarrier: (b: unknown) => call<{ id: string; env: string }>("POST", "/v1/carriers", b),

    // Webhooks de saída
    webhooks: () => call<{ webhooks: { id: string; name: string; url: string; events: string[]; active: boolean }[] }>("GET", "/v1/webhooks"),
    createWebhook: (name: string, url: string, events: string[]) => call<{ id: string; secret: string }>("POST", "/v1/webhooks", { name, url, events }),
    updateWebhook: (id: string, b: { active?: boolean; url?: string; events?: string[]; name?: string }) => call<{ ok: boolean }>("PATCH", `/v1/webhooks/${id}`, b),
    rotateWebhookSecret: (id: string) => call<{ secret: string }>("POST", `/v1/webhooks/${id}/rotate-secret`),
    deliveries: (status?: string) => call<{ deliveries: Delivery[] }>("GET", `/v1/webhooks/deliveries${q({ status })}`),
    resendDelivery: (id: string) => call<{ ok: boolean }>("POST", `/v1/webhooks/deliveries/${id}/resend`),

    // Equipe
    members: (projectId2: string) => call<{ members: Member[] }>("GET", `/v1/projects/${projectId2}/members`),
    requestMembership: (organizationId: string, projectId2: string, role: "operator" | "affiliate") => call<{ id: string }>("POST", "/v1/memberships", { organizationId, projectId: projectId2, role }),
    approveMembership: (id: string, preset: string) => call<void>("POST", `/v1/memberships/${id}/approve`, { preset }),
    rejectMembership: (id: string) => call<void>("POST", `/v1/memberships/${id}/reject`, {}),

    // Importação
    importCsv: (csv: string, source = "csv") => call<{ id: string; stats: ImportStats }>("POST", "/v1/imports", { csv, source }),

    // Back-office (admin da plataforma)
    backofficeOverview: () => call<{ organizations: BackofficeOrg[] }>("GET", "/v1/backoffice/overview"),
    createSubscription: (orgId: string, b: { planKey: string; monthlyFeeCents: number; orderCap: number }) => call<{ id: string }>("POST", `/v1/backoffice/organizations/${orgId}/subscription`, b),
    setBackofficeStatus: (orgId: string, to: string, reason?: string) => call<{ ok: boolean }>("POST", `/v1/backoffice/organizations/${orgId}/status`, { to, reason }),
    discardPii: (orgId: string, confirm: string) => call<{ customers: number; rawEvents: number }>("POST", `/v1/backoffice/organizations/${orgId}/discard-pii`, { confirm }),
    backofficeAudit: (organizationId?: string) => call<{ entries: { id: number; organizationId: string | null; action: string; meta: Record<string, unknown>; at: string }[] }>("GET", `/v1/backoffice/audit${q({ organizationId })}`),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;

export interface OrderRow { id: string; externalId: string | null; totalCents: number; customerName: string | null; customerPhone: string | null; createdAt: string; platform: string; shipping: string; payment: string; releasedAt: string | null; buckets: string[] }
export interface OrderDetail { id: string; externalId: string | null; totalCents: number; afterPay: boolean; releasedAt: string | null; customerName: string | null; phone: string | null; email: string | null; cpf: string | null; platform: string; shipping: string; payment: string; paidAt: string | null; deliveredAt: string | null; events: { axis: string; from: string | null; to: string; at: string }[] }
export interface Product { id: string; name: string; sku: string | null; private: boolean; active: boolean }
export interface Plan { id: string; productId: string; name: string; priceCents: number; commissionRule: { type?: string; bps?: number; cents?: number }; bom: { stockItemId: string; qty: number }[]; active: boolean }
export interface StockItem { id: string; sku: string; name: string; quantity: number; minQuantity: number }
export interface StockMovement { id: number; delta: number; reason: string; orderId: string | null; createdAt: string }
export interface SalesEvent { id: string; provider: string; eventId: string; status: string; attempts: number; receivedAt: string }
export interface Delivery { id: string; webhookId: string; event: string; status: string; attempts: number; lastStatusCode: number | null; lastError: string | null; nextAttemptAt: string | null; createdAt: string }
export interface Member { id: string; userId: string; email: string; name: string; role: string; capabilities: string[]; projectId: string | null; approved: boolean }
export interface ImportStats { total: number; created: number; duplicates: number; failed: number; errors: { row: number; error: string }[] }
export interface BackofficeOrg { organizationId: string; name: string; status: string; plan: string | null; monthlyFeeCents: number | null; orderCap: number; usedThisMonth: number; projects: number; goLiveAt: string | null; suspendedAt: string | null }
