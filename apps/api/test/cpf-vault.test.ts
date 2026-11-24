import { describe, it, expect } from "vitest";
import { makeCpfVault } from "../src/auth/cpf-vault";

const KEY = "a".repeat(64);

describe("cofre de CPF", () => {
  const v = makeCpfVault(KEY);
  it("cifra e decifra (ida e volta) sem expor o texto claro", () => {
    const enc = v.encrypt("52998224725");
    expect(enc.toString("utf8")).not.toContain("52998224725");
    expect(v.decrypt(enc)).toBe("52998224725");
  });
  it("cada cifragem usa IV novo (mesmo CPF, bytes diferentes)", () => {
    expect(v.encrypt("52998224725").equals(v.encrypt("52998224725"))).toBe(false);
  });
  it("detecta adulteração (GCM)", () => {
    const enc = v.encrypt("52998224725");
    enc[enc.length - 1] = (enc[enc.length - 1] ?? 0) ^ 1;
    expect(() => v.decrypt(enc)).toThrow();
  });
  it("hash é determinístico, depende da chave e ignora pontuação", () => {
    expect(v.hash("529.982.247-25")).toBe(v.hash("52998224725"));
    expect(makeCpfVault("b".repeat(64)).hash("52998224725")).not.toBe(v.hash("52998224725"));
  });
  it("recusa chave inválida", () => {
    expect(() => makeCpfVault("curta")).toThrow();
    expect(() => makeCpfVault("z".repeat(64))).toThrow();
  });
});
