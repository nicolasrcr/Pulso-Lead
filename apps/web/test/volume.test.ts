import { describe, it, expect } from "vitest";
import { volumeMessage } from "../src/volume";
import { createApiClient } from "../src/api";

describe("aviso de volume (nunca bloqueia)", () => {
  it("sem alerta: sem mensagem", () => {
    expect(volumeMessage({ used: 10, cap: 1000, pct: 1, alert: null, over: false })).toBeNull();
  });
  it("80%: aviso de atenção", () => {
    const m = volumeMessage({ used: 800, cap: 1000, pct: 80, alert: "80", over: false })!;
    expect(m.level).toBe("warning");
    expect(m.text).toContain("800");
    expect(m.text).toContain("1.000");
  });
  it("100%: aviso crítico, mas segue operando", () => {
    const m = volumeMessage({ used: 1000, cap: 1000, pct: 100, alert: "100", over: false })!;
    expect(m.level).toBe("danger");
    expect(m.text.toLowerCase()).toContain("sem bloqueio");
  });
  it("acima do teto: informa o excedente", () => {
    const m = volumeMessage({ used: 1030, cap: 1000, pct: 103, alert: "100", over: true })!;
    expect(m.text).toContain("30");
  });
  it("cap 0 (sem assinatura): não alerta", () => {
    expect(volumeMessage({ used: 5, cap: 0, pct: 0, alert: null, over: false })).toBeNull();
  });
});

describe("cliente: kanban e volume", () => {
  it("consulta /v1/kanban e /v1/volume com o projeto selecionado", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ buckets: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: "http://api", fetch: f, store: { get: () => "t", set: () => undefined } });
    api.selectProject("11111111-1111-1111-1111-111111111111");
    await api.kanban(); await api.volume();
    expect(calls.map((c) => c.url)).toEqual(["http://api/v1/kanban", "http://api/v1/volume"]);
    expect(calls[0]!.headers["x-project-id"]).toBe("11111111-1111-1111-1111-111111111111");
  });
});
