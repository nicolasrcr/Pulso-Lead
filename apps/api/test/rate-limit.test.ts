import { describe, it, expect } from "vitest";
import { makeLimiter } from "../src/rate-limit";

describe("limitador de taxa", () => {
  it("permite até o máximo na janela e bloqueia o excedente, por chave", () => {
    let t = 0; const l = makeLimiter(3, 1000, () => t);
    expect([1, 2, 3, 4].map(() => l.take("a"))).toEqual([true, true, true, false]);
    expect(l.take("b")).toBe(true);
  });
  it("reabre depois da janela", () => {
    let t = 0; const l = makeLimiter(1, 1000, () => t);
    expect(l.take("a")).toBe(true); expect(l.take("a")).toBe(false);
    t = 1001; expect(l.take("a")).toBe(true);
  });
});
