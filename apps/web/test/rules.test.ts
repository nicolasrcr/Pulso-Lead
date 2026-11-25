import { describe, it, expect } from "vitest";
import { parseMoneyToCents, parsePercentToBps, buildCommissionRule, describeRule, parseBrDateTimeLocal } from "../src/rules";

describe("dinheiro e comissão", () => {
  it("converte texto em centavos sem float", () => {
    expect(parseMoneyToCents("12,34")).toBe(1234);
    expect(parseMoneyToCents("1.234,5")).toBe(123450);
    expect(parseMoneyToCents("0,29")).toBe(29);
    expect(parseMoneyToCents("197.90")).toBe(19790);
    expect(parseMoneyToCents("100")).toBe(10000);
    for (const bad of ["", "abc", "-1", "1,234", "1,2,3"]) expect(parseMoneyToCents(bad)).toBeNull();
  });
  it("percentual em bps (0–100%)", () => {
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("12,5")).toBe(1250);
    expect(parsePercentToBps("0,01")).toBe(1);
    for (const bad of ["101", "-5", "x", "", "1,234"]) expect(parsePercentToBps(bad)).toBeNull();
  });
  it("monta e descreve a regra", () => {
    expect(buildCommissionRule("percent", "12,5")).toEqual({ type: "percent", bps: 1250 });
    expect(buildCommissionRule("fixed", "15")).toEqual({ type: "fixed", cents: 1500 });
    expect(buildCommissionRule("percent", "x")).toBeNull();
    expect(describeRule({ type: "percent", bps: 1250 })).toBe("12,5% do pedido");
    expect(describeRule({ type: "fixed", cents: 1500 })).toBe("R$ 15,00 fixo");
    expect(describeRule({ type: "?" })).toBe("regra desconhecida");
  });
  it("data local do formulário vira ISO só quando válida", () => {
    expect(parseBrDateTimeLocal("2026-11-01T10:00")).toBe("2026-11-01 10:00:00");
    expect(parseBrDateTimeLocal("")).toBeNull();
  });
});
