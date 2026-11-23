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
