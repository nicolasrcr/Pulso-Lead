import { describe, it, expect } from "vitest";
import { IdempotencyStore, idempotencyKey } from "../src/idempotency";

describe("idempotência de webhook (project_id, provider, event_id)", () => {
  it("o mesmo evento é processado uma única vez", () => {
    const s = new IdempotencyStore();
    const k = idempotencyKey({ projectId: "p1", provider: "braip", eventId: "e1" });
    expect(s.claim(k)).toBe(true);
    expect(s.claim(k)).toBe(false);
  });
  it("projetos diferentes não colidem", () => {
    const s = new IdempotencyStore();
    expect(s.claim(idempotencyKey({ projectId: "p1", provider: "braip", eventId: "e1" }))).toBe(true);
    expect(s.claim(idempotencyKey({ projectId: "p2", provider: "braip", eventId: "e1" }))).toBe(true);
  });
  it("campos vazios são recusados", () => {
    expect(() => idempotencyKey({ projectId: "", provider: "x", eventId: "y" })).toThrow();
  });
});
