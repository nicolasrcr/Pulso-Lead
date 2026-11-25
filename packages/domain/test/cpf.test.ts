import { describe, it, expect } from "vitest";
import { isValidCpf, normalizeCpf, maskCpf, maskPhone, normalizePhone } from "../src/cpf";

describe("CPF", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });
  it("recusa sequências repetidas e tamanho errado", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("000.000.000-00")).toBe(false);
    expect(isValidCpf("1234")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });
  it("normaliza para só dígitos", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
  });
  it("máscara não revela mais que os 2 últimos dígitos", () => {
    expect(maskCpf("529.982.247-25")).toBe("***.***.***-25");
    expect(maskCpf("52998224725")).toBe("***.***.***-25");
    expect(maskCpf("xx")).toBe("***.***.***-**");
  });
  it("telefone: normaliza e mascara mantendo DDD e 2 últimos", () => {
    expect(normalizePhone("(61) 99999-1234")).toBe("61999991234");
    expect(maskPhone("61999991234")).toBe("(61) *****-**34");
    expect(maskPhone("")).toBe("");
  });
});
