import { describe, it, expect } from "vitest";
import worker, { renderPage, safeColor, statusLabel } from "../src/worker.js";

const data = { trackingCode: "JT123", status: "em_transito", delivered: false, carrier: "Enviado via J&T Express",
  history: [{ status: "coletado", at: "2026-11-01T13:00:00Z" }, { status: "em_transito", at: "2026-11-02T10:00:00Z" }] };

describe("página pública de rastreio", () => {
  it("mostra selo da transportadora, status legível e histórico em ordem", () => {
    const h = renderPage(data, { brand: "Loja Exemplo", color: "#1a73e8" });
    expect(h).toContain("Enviado via J&amp;T Express");
    expect(h).toContain("Em trânsito");
    expect(h.indexOf("Coletado")).toBeLessThan(h.indexOf("Em trânsito", h.indexOf("Coletado")));
    expect(h).toContain("Loja Exemplo");
  });
  it("escapa HTML (marca e código não injetam script)", () => {
    const h = renderPage({ ...data, trackingCode: "<script>x</script>" }, { brand: '"><img src=x onerror=alert(1)>', color: "red;}</style><script>" });
    expect(h).not.toContain("<script>x");
    expect(h).not.toContain("<img src=x");
    expect(h).not.toMatch(/<script>/);
  });
  it("cor só aceita hex válido", () => {
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("#1A73E8")).toBe("#1A73E8");
    expect(safeColor("red")).toBe("#0b5fff");
    expect(safeColor("#12")).toBe("#0b5fff");
  });
  it("status desconhecido vira texto humanizado, nunca código cru", () => {
    expect(statusLabel("entregue")).toBe("Entregue");
    expect(statusLabel("algo_novo")).toBe("Algo novo");
  });
  it("worker: 404 para código inválido sem chamar a API; repassa 404 da API como página amigável", async () => {
    let calls = 0;
    const env = { API_BASE: "https://api.exemplo.com", fetch: async () => { calls++; return new Response("{}", { status: 404 }); } };
    expect((await worker.fetch(new Request("https://t.exemplo.com/a%20b"), env)).status).toBe(404);
    expect(calls).toBe(0);
    const r = await worker.fetch(new Request("https://t.exemplo.com/JT999"), env);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain("não encontrado");
    expect(calls).toBe(1);
  });
  it("worker: sucesso devolve HTML com cache curto e sem indexação", async () => {
    const env = { API_BASE: "https://api.exemplo.com", BRAND_NAME: "Minha Loja", fetch: async () => new Response(JSON.stringify(data), { status: 200 }) };
    const r = await worker.fetch(new Request("https://t.exemplo.com/JT123"), env);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
    expect(r.headers.get("cache-control")).toContain("max-age=60");
    expect(await r.text()).toContain("Minha Loja");
  });
});
