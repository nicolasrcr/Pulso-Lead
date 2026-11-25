import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_ATTEMPTS = 8;

/** Cabeçalho `t=<unix>,v1=<hmac-sha256 hex de "t.corpo">` (mesmo formato dos provedores de pagamento mais usados). */
export function signWebhook(secret: string, timestampSec: number, body: string): string {
  const v1 = createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
  return `t=${timestampSec},v1=${v1}`;
}

export function verifyWebhook(secret: string, header: string, body: string, nowSec: number, toleranceSec = 300): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = Buffer.from(signWebhook(secret, t, body).split("v1=")[1]!, "hex");
  return timingSafeEqual(expected, Buffer.from(m[2]!, "hex"));
}

/** 30 s, 1 min, 2 min, 4 min… até 6 h. `attempt` = quantas tentativas já falharam (0-based). */
export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt), 6 * 3600);
}
