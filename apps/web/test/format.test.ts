import { describe, it, expect } from "vitest";
import { formatBrl, formatBps } from "../src/format";

describe("formatação", () => {
  it("centavos inteiros em reais (sem float)", () => {
    expect(formatBrl(0)).toMatch(/^R\$\s0,00$/);
    expect(formatBrl(19900)).toMatch(/^R\$\s199,00$/);
    expect(formatBrl(123456789)).toMatch(/^R\$\s1\.234\.567,89$/);
    expect(formatBrl(-1990)).toMatch(/^-R\$\s19,90$/);
  });
  it("pontos-base em porcentagem", () => {
    expect(formatBps(2500)).toBe("25%");
    expect(formatBps(3333)).toBe("33,33%");
    expect(formatBps(0)).toBe("0%");
  });
});
