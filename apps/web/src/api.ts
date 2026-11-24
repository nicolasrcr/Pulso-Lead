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

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = o.store.get();
    if (token) headers.authorization = `Bearer ${token}`;
    if (projectId) headers["x-project-id"] = projectId; // null = "Todos os projetos"
    const res = await doFetch(`${o.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) { o.store.set(null); o.onUnauthorized?.(); }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, data.error ?? "error");
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

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
  };
}
