import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, validatePassword } from "../src/auth/password";
import { newSessionToken, hashToken } from "../src/auth/token";

describe("senha (scrypt)", () => {
  it("hash não contém a senha e verifica corretamente", async () => {
    const h = await hashPassword("uma-senha-longa-123");
    expect(h).not.toContain("uma-senha-longa-123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("uma-senha-longa-123", h)).toBe(true);
    expect(await verifyPassword("outra-senha-123", h)).toBe(false);
  });
  it("mesmo texto gera hashes diferentes (salt)", async () => {
    expect(await hashPassword("abcdefghij12")).not.toBe(await hashPassword("abcdefghij12"));
  });
  it("hash malformado nunca verifica", async () => {
    expect(await verifyPassword("x", "lixo")).toBe(false);
    expect(await verifyPassword("x", "scrypt$$")).toBe(false);
  });
  it("política: mínimo de 10 caracteres", () => {
    expect(validatePassword("curta")).toBe(false);
    expect(validatePassword("longa-o-bastante")).toBe(true);
  });
});

describe("token de sessão", () => {
  it("é opaco, aleatório e só o hash é persistido", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).not.toBe(a);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
