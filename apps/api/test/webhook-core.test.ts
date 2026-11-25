import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhook, backoffSeconds, MAX_ATTEMPTS } from "../src/webhooks/signing";
import { assertPublicUrl, assertResolvedPublic } from "../src/webhooks/url-guard";
import { makeSecretBox } from "../src/webhooks/secret-box";

describe("assinatura HMAC dos webhooks", () => {
  const body = JSON.stringify({ a: 1 });
  it("assina e verifica; corpo ou segredo diferentes falham", () => {
    const h = signWebhook("segredo", 1_700_000_000, body);
    expect(h).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook("segredo", h, body, 1_700_000_100)).toBe(true);
    expect(verifyWebhook("outro", h, body, 1_700_000_100)).toBe(false);
    expect(verifyWebhook("segredo", h, body + " ", 1_700_000_100)).toBe(false);
  });
  it("rejeita timestamp fora da tolerância (replay) e cabeçalho malformado", () => {
    const h = signWebhook("s", 1_700_000_000, body);
    expect(verifyWebhook("s", h, body, 1_700_000_000 + 301)).toBe(false);
    expect(verifyWebhook("s", h, body, 1_700_000_000 - 301)).toBe(false);
    expect(verifyWebhook("s", "lixo", body, 1_700_000_000)).toBe(false);
    expect(verifyWebhook("s", "t=1,v1=zz", body, 1)).toBe(false);
  });
  it("backoff exponencial limitado e tentativas máximas", () => {
    expect([0, 1, 2, 3].map(backoffSeconds)).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(30)).toBe(6 * 3600);
    expect(MAX_ATTEMPTS).toBe(8);
  });
});

describe("proteção contra SSRF na URL do webhook", () => {
  it("aceita https público", () => expect(() => assertPublicUrl("https://hooks.exemplo.com.br/x?y=1")).not.toThrow());
  it.each([
    "http://exemplo.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.1/x",
    "https://172.16.0.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://[fd00::1]/x", "https://app.internal/x",
    "https://user:pw@exemplo.com/x", "ftp://exemplo.com", "não é url", "https://0.0.0.0/x", "https://[::ffff:127.0.0.1]/x",
  ])("recusa %s", (u) => expect(() => assertPublicUrl(u)).toThrow());
});

describe("SSRF por DNS: o IP resolvido também precisa ser público", () => {
  const res = (...ips: string[]) => async () => ips;
  it("aceita host que resolve só para IPs públicos", async () => {
    await expect(assertResolvedPublic("https://hooks.exemplo.com.br/x", res("200.147.1.1", "2606:4700::1"))).resolves.toBeUndefined();
  });
  it.each([["10.0.0.7"], ["127.0.0.1"], ["169.254.169.254"], ["192.168.0.9"], ["::1"], ["fd00::5"], ["fe80::1"], ["::ffff:10.1.1.1"], ["100.64.0.1"]])("recusa host que resolve para %s", async (ip) => {
    await expect(assertResolvedPublic("https://evil.exemplo.com/x", res(ip))).rejects.toThrow(/interno/);
  });
  it("recusa se QUALQUER endereço resolvido for interno (DNS com registros mistos)", async () => {
    await expect(assertResolvedPublic("https://evil.exemplo.com/x", res("200.147.1.1", "10.0.0.1"))).rejects.toThrow(/interno/);
  });
  it("falha fechada: erro de DNS ou resposta vazia derruba a entrega", async () => {
    await expect(assertResolvedPublic("https://x.exemplo.com/x", async () => { throw new Error("ENOTFOUND"); })).rejects.toThrow();
    await expect(assertResolvedPublic("https://x.exemplo.com/x", res())).rejects.toThrow();
  });
  it("IP literal público não consulta DNS; literal interno é recusado", async () => {
    let calls = 0;
    await assertResolvedPublic("https://200.147.1.1/x", async () => { calls++; return []; });
    expect(calls).toBe(0);
    await expect(assertResolvedPublic("https://10.0.0.1/x", res("200.147.1.1"))).rejects.toThrow(/interno/);
  });
});

describe("caixa de segredos (AES-256-GCM)", () => {
  const box = makeSecretBox("a".repeat(64));
  it("ida e volta; IV novo a cada vez; adulteração detectada", () => {
    const a = box.seal("whsec_123"), b = box.seal("whsec_123");
    expect(a).not.toBe(b);
    expect(box.open(a)).toBe("whsec_123");
    const t = Buffer.from(a, "base64"); t[t.length - 1] = (t[t.length - 1] ?? 0) ^ 1;
    expect(() => box.open(t.toString("base64"))).toThrow();
  });
  it("chave de outra finalidade não abre", () => {
    expect(() => makeSecretBox("b".repeat(64)).open(box.seal("x"))).toThrow();
  });
});
