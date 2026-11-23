import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";

describe("API", () => {
  it("GET /health responde ok sem autenticação", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
  it("GET /v1/templates/pos-pago expõe o template versionado", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/templates/pos-pago" });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(1);
  });
  it("template inexistente devolve 404", async () => {
    const res = await buildApp().inject({ method: "GET", url: "/v1/templates/nao-existe" });
    expect(res.statusCode).toBe(404);
  });
});
