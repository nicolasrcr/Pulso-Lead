import type pg from "pg";
import { tx } from "../db.ts";
import { backoffSeconds, MAX_ATTEMPTS, signWebhook } from "./signing.ts";
import { assertResolvedPublic, dnsResolver, type Resolver } from "./url-guard.ts";
import type { SecretBox } from "./secret-box.ts";

export interface DispatchDeps {
  systemUserId: string; secretBox: SecretBox; fetch?: typeof fetch; resolve?: Resolver; limit?: number; timeoutMs?: number; now?: () => Date;
}
export interface DispatchResult { delivered: number; retried: number; failed: number }

async function markSync(c: { query(sql: string, p?: unknown[]): Promise<unknown> }, x: Due, ok: boolean, err: string | null) {
  const orderId = (x.payload as { orderId?: string } | null)?.orderId;
  if (x.event === "SHIPPING_REGISTER" && orderId) await c.query("select app.mark_tracking_sync($1,$2,$3)", [orderId, ok, err]);
}

interface Due { id: string; event: string; payload: unknown; attempts: number; created_at: Date; url: string; secret: string }

/**
 * Entrega os webhooks vencidos. Roda como o usuário de sistema (admin da plataforma) porque atravessa projetos.
 * `skip locked` permite vários workers sem entrega dupla; redirecionamentos NÃO são seguidos (evita SSRF por redirect).
 */
export async function dispatchDue(pool: pg.Pool, d: DispatchDeps): Promise<DispatchResult> {
  const doFetch = d.fetch ?? fetch;
  // Com fetch injetado (testes) não há rede real; o DNS real só entra quando o envio é de verdade.
  const resolve: Resolver = d.resolve ?? (d.fetch ? async () => ["200.147.1.1"] : dnsResolver);
  const out: DispatchResult = { delivered: 0, retried: 0, failed: 0 };
  await tx(pool, { userId: d.systemUserId }, async (c) => {
    const due = (await c.query(
      `select d.id, d.event, d.payload, d.attempts, d.created_at, w.url, w.secret
         from webhook_deliveries d join outbound_webhooks w on w.id = d.webhook_id
        where d.status = 'pending' and d.next_attempt_at <= now() and w.active
        order by d.next_attempt_at limit $1 for update of d skip locked`, [d.limit ?? 20])).rows as Due[];
    for (const x of due) {
      let code: number | null = null, error: string | null = null;
      try {
        await assertResolvedPublic(x.url, resolve);
        const body = JSON.stringify({ id: x.id, event: x.event, createdAt: x.created_at, data: x.payload });
        const ts = Math.floor((d.now?.() ?? new Date()).getTime() / 1000);
        const res = await doFetch(x.url, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(d.timeoutMs ?? 10_000),
          headers: { "content-type": "application/json", "x-pulso-event": x.event, "x-pulso-delivery": x.id,
                     "x-pulso-signature": signWebhook(d.secretBox.open(x.secret), ts, body) },
          body,
        });
        code = res.status;
        if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
      } catch (e) {
        error = (e instanceof Error ? e.message : "erro").slice(0, 300);
      }
      if (!error) {
        await c.query("update webhook_deliveries set status='delivered', attempts=attempts+1, last_status_code=$2, last_error=null, delivered_at=now(), next_attempt_at=null where id=$1", [x.id, code]);
        out.delivered++;
        await markSync(c, x, true, null);
      } else if (x.attempts + 1 >= MAX_ATTEMPTS) {
        await c.query("update webhook_deliveries set status='failed', attempts=attempts+1, last_status_code=$2, last_error=$3, next_attempt_at=null where id=$1", [x.id, code, error]);
        out.failed++;
        await markSync(c, x, false, error);
      } else {
        await c.query("update webhook_deliveries set attempts=attempts+1, last_status_code=$2, last_error=$3, next_attempt_at = now() + make_interval(secs => $4) where id=$1", [x.id, code, error, backoffSeconds(x.attempts)]);
        out.retried++;
      }
    }
  });
  return out;
}
