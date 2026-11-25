import { describe, it, expect } from "vitest";
import { createApiClient } from "../src/api";

function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: {} };
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const mem = () => { let v: string | null = null; return { get: () => v, set: (x: string | null) => { v = x; } }; };

describe("cliente da API", () => {
  it("login guarda o token e as próximas chamadas enviam Authorization", async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { token: "tok", expiresAt: "x" } }, { status: 200, body: { projects: [] } }]);
    const api = createApiClient({ baseUrl: "http://api", fetch: f, store: mem() });
    await api.login("a@b.co", "senha-longa-123");
    await api.projects();
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("projeto selecionado vai em x-project-id; 'Todos os projetos' (null) não envia o header", async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
    const store = mem(); store.set("tok");
    const api = createApiClient({ baseUrl: "http://api", fetch: f, store });
    api.selectProject("11111111-1111-1111-1111-111111111111");
    await api.projects();
    api.selectProject(null);
    await api.projects();
    expect((calls[0]!.init.headers as Record<string, string>)["x-project-id"]).toBe("11111111-1111-1111-1111-111111111111");
    expect((calls[1]!.init.headers as Record<string, string>)["x-project-id"]).toBeUndefined();
  });
  it("401 limpa o token e avisa a aplicação", async () => {
    const { f } = fakeFetch([{ status: 401, body: { error: "unauthorized" } }]);
    const store = mem(); store.set("velho");
    let expired = 0;
    const api = createApiClient({ baseUrl: "http://api", fetch: f, store, onUnauthorized: () => { expired++; } });
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(store.get()).toBeNull();
    expect(expired).toBe(1);
  });
  it("erro de API vira ApiError com status e código", async () => {
    const { f } = fakeFetch([{ status: 403, body: { error: "forbidden" } }]);
    const store = mem(); store.set("tok");
    const api = createApiClient({ baseUrl: "http://api", fetch: f, store });
    await expect(api.createProject("11111111-1111-1111-1111-111111111111", "x")).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("cliente da API — telas", () => {
  it("download usa Authorization e projeto e devolve o texto + nome do arquivo", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("a,b\n1,2\n", { status: 200, headers: { "content-disposition": 'attachment; filename="pedidos.csv"' } }); }) as unknown as typeof fetch;
    const st = mem(); st.set("tok");
    const api = createApiClient({ baseUrl: "http://api", fetch: f, store: st });
    api.selectProject("p1");
    const r = await api.download("/v1/export/orders.csv");
    expect(r).toEqual({ filename: "pedidos.csv", text: "a,b\n1,2\n" });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect((calls[0]!.init.headers as Record<string, string>)["x-project-id"]).toBe("p1");
  });
  it("423 vira ApiError('organization_suspended')", async () => {
    const { f } = fakeFetch([{ status: 423, body: { error: "organization_suspended" } }]);
    const api = createApiClient({ baseUrl: "http://api", fetch: f, store: mem() });
    await expect(api.createProduct("X")).rejects.toMatchObject({ status: 423, code: "organization_suspended" });
  });
  it("métodos mapeiam para as rotas certas", async () => {
    const { f, calls } = fakeFetch(Array.from({ length: 12 }, () => ({ status: 200, body: {} })));
    const api = createApiClient({ baseUrl: "", fetch: f, store: mem() });
    await api.orders(); await api.order("o1"); await api.releaseOrder("o1");
    await api.transition("o1", "payment", "pendente", "pago"); await api.returnOrder("o1", "returned", "x");
    await api.stockMovements("s1"); await api.adjustStock("s1", -2, "loss");
    await api.setBackofficeStatus("org1", "suspenso", "motivo"); await api.discardPii("org1", "org1");
    await api.resendTracking("o1"); await api.reprocessSales(); await api.createConnector("braip");
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "GET /v1/orders", "GET /v1/orders/o1", "POST /v1/orders/o1/release", "POST /v1/orders/o1/transition", "POST /v1/orders/o1/return",
      "GET /v1/stock-items/s1/movements", "POST /v1/stock-items/s1/adjust", "POST /v1/backoffice/organizations/org1/status",
      "POST /v1/backoffice/organizations/org1/discard-pii", "POST /v1/orders/o1/tracking/resend", "POST /v1/sales-events/reprocess", "POST /v1/connectors",
    ]);
    expect(JSON.parse(calls[3]!.init.body as string)).toEqual({ axis: "payment", from: "pendente", to: "pago" });
  });
});
