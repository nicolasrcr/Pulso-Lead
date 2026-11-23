// Cloudflare Worker de ingestão. Arquivo .js (nunca .mjs).
// Regra: valida a assinatura, NÃO processa regra de negócio; encaminha o evento cru com chave de idempotência.
// O processamento idempotente acontece na API/fila (UNIQUE project_id, provider, event_id).

const enc = new TextEncoder();

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Rota: POST /w/:projectId/:provider
 * deps.getSecret(projectId, provider) -> segredo de assinatura; deps.forward(evento) -> { ok }
 */
export async function handleWebhook(request, deps) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/w\/([^/]+)\/([^/]+)$/);
  if (!m) return json(404, { error: "not_found" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const [, projectId, provider] = m;
  const raw = await request.text();
  const given = request.headers.get("x-signature") ?? "";
  const secret = await deps.getSecret(projectId, provider);
  if (!secret || !given || !safeEqual(await hmacHex(secret, raw), given)) return json(401, { error: "invalid_signature" });

  let payload;
  try { payload = JSON.parse(raw); } catch { return json(422, { error: "invalid_json" }); }
  const eventId = payload?.id ?? payload?.event_id;
  if (!eventId) return json(422, { error: "missing_event_id" });

  const res = await deps.forward({ projectId, provider, eventId: String(eventId), raw });
  return res.ok ? json(202, { accepted: true }) : json(503, { error: "forward_failed" });
}

export default {
  async fetch(request, env) {
    return handleWebhook(request, {
      // Resolve o segredo pela API interna; nunca guarda segredo em código.
      getSecret: async (projectId, provider) => {
        const r = await fetch(`${env.INGEST_FORWARD_URL}/internal/webhook-secret?project=${encodeURIComponent(projectId)}&provider=${encodeURIComponent(provider)}`, {
          headers: { authorization: `Bearer ${env.INGEST_FORWARD_TOKEN}` },
        });
        return r.ok ? (await r.json()).secret : null;
      },
      forward: async (evt) => {
        const r = await fetch(`${env.INGEST_FORWARD_URL}/internal/ingest`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env.INGEST_FORWARD_TOKEN}` },
          body: JSON.stringify(evt),
        });
        return { ok: r.ok };
      },
    });
  },
};
