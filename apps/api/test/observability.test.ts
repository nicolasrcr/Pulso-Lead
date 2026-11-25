import { describe, it, expect } from "vitest";
import type pg from "pg";
import { buildApp } from "../src/app";
import { scrub, type ErrorReport } from "../src/observability";

const KEY = "5".repeat(64);
describe("observabilidade", () => {
  it("scrub remove segredos de query string", () => {
    expect(scrub("/v1/hooks/sales/x?token=abc&y=1")).toBe("/v1/hooks/sales/x?token=[redigido]&y=1");
    expect(scrub("/a?password=p&secret=s")).toBe("/a?password=[redigido]&secret=[redigido]");
  });
  it("5xx vai ao reporter com requestId, sem segredo na URL, e o cliente recebe só o requestId", async () => {
    const reports: ErrorReport[] = [];
    const pool = { query: async () => { throw new Error("falha interna"); } } as unknown as pg.Pool;
    const app = buildApp({ pool, cpfKey: KEY, reporter: (r) => reports.push(r) });
    const r = await app.inject({ method: "GET", url: "/v1/projects?token=SEGREDO", headers: { authorization: "Bearer abc" } });
    expect(r.statusCode).toBe(500);
    expect(r.json().error).toBe("internal_error");
    expect(r.json().requestId).toBe(r.headers["x-request-id"]);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.url).not.toContain("SEGREDO");
    expect(reports[0]!.message).toBe("falha interna");
    expect(JSON.stringify(r.json())).not.toContain("falha interna");
  });
  it("/ready responde 503 quando o banco cai e 200 quando responde; /health sempre vive", async () => {
    const down = buildApp({ pool: { query: async () => { throw new Error("x"); } } as unknown as pg.Pool, cpfKey: KEY });
    expect((await down.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
    expect((await down.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const up = buildApp({ pool: { query: async () => ({ rows: [{}] }) } as unknown as pg.Pool, cpfKey: KEY });
    expect((await up.inject({ method: "GET", url: "/ready" })).statusCode).toBe(200);
    expect((await buildApp().inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
  });
});
