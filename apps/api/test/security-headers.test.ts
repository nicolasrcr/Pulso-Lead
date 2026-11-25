import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";

describe("cabeçalhos de segurança e CORS", () => {
  it("envia cabeçalhos de segurança padrão em toda resposta", async () => {
    const r = await buildApp().inject({ method: "GET", url: "/health" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBeDefined();
    expect(r.headers["strict-transport-security"]).toMatch(/max-age=/);
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
  it("sem CORS_ORIGINS não libera nenhuma origem (somente mesma origem)", async () => {
    const r = await buildApp().inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("com lista de origens, libera só as listadas e responde preflight", async () => {
    const app = buildApp({ corsOrigins: ["https://app.exemplo.com.br"] });
    const ok = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://app.exemplo.com.br" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://app.exemplo.com.br");
    const no = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
    expect(no.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await app.inject({ method: "OPTIONS", url: "/v1/orders", headers: { origin: "https://app.exemplo.com.br", "access-control-request-method": "POST", "access-control-request-headers": "authorization,x-project-id,content-type" } });
    expect(pre.statusCode).toBeLessThan(300);
    expect(String(pre.headers["access-control-allow-headers"]).toLowerCase()).toContain("x-project-id");
  });
});
