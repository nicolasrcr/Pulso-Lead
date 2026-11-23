import { describe, it, expect } from "vitest";
import { handleWebhook, hmacHex } from "../src/worker.js";

const secret = "s3cr3t";
const body = JSON.stringify({ id: "evt_1", type: "sale.paid" });

async function req(path, { sig, method = "POST", payload = body } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (sig !== undefined) headers.set("x-signature", sig);
  return new Request(`https://ingest.test${path}`, { method, headers, body: method === "POST" ? payload : undefined });
}
const deps = (over = {}) => ({
  getSecret: async () => secret,
  forward: async (e) => { deps.last = e; return { ok: true }; },
  ...over,
});

describe("ingestão de webhook", () => {
  it("rejeita método diferente de POST", async () => {
    const r = await handleWebhook(await req("/w/p1/braip", { method: "GET" }), deps());
    expect(r.status).toBe(405);
  });
  it("rejeita assinatura ausente ou inválida (401) e não encaminha", async () => {
    let called = false;
    const d = deps({ forward: async () => { called = true; return { ok: true }; } });
    expect((await handleWebhook(await req("/w/p1/braip"), d)).status).toBe(401);
    expect((await handleWebhook(await req("/w/p1/braip", { sig: "deadbeef" }), d)).status).toBe(401);
    expect(called).toBe(false);
  });
  it("assinatura válida: encaminha o evento cru com chave de idempotência e responde 202", async () => {
    const sig = await hmacHex(secret, body);
    const r = await handleWebhook(await req("/w/p1/braip", { sig }), deps());
    expect(r.status).toBe(202);
    expect(deps.last).toMatchObject({ projectId: "p1", provider: "braip", eventId: "evt_1", raw: body });
  });
  it("sem event id no payload: 422", async () => {
    const p = JSON.stringify({ type: "x" });
    const sig = await hmacHex(secret, p);
    expect((await handleWebhook(await req("/w/p1/braip", { sig, payload: p }), deps())).status).toBe(422);
  });
  it("falha ao encaminhar: 503 para o provedor tentar de novo", async () => {
    const sig = await hmacHex(secret, body);
    const r = await handleWebhook(await req("/w/p1/braip", { sig }), deps({ forward: async () => ({ ok: false }) }));
    expect(r.status).toBe(503);
  });
  it("rota desconhecida: 404", async () => {
    expect((await handleWebhook(await req("/outra"), deps())).status).toBe(404);
  });
});
