import { createHash } from "node:crypto";
import type pg from "pg";

/** Chave bigint estável por nome de job (advisory locks usam inteiros de 64 bits). */
function lockKey(name: string): string {
  return createHash("sha256").update(`pulso:job:${name}`).digest().readBigInt64BE(0).toString();
}

export type LockResult<T> = { ran: true; value: T } | { ran: false };

/**
 * Exclusão mútua entre instâncias da API: só uma executa o job por vez; as demais pulam o ciclo.
 * Usa `pg_try_advisory_xact_lock` dentro de uma transação aberta enquanto o job roda (outras conexões fazem o trabalho).
 * Como a trava é de transação, ela é liberada no COMMIT/ROLLBACK, inclusive se o processo cair (a conexão fecha),
 * e funciona também atrás de pooler em modo transação, onde travas de sessão não são confiáveis.
 */
export async function withJobLock<T>(pool: pg.Pool, name: string, fn: () => Promise<T>): Promise<LockResult<T>> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // O corpo do job roda em outras conexões; esta fica ociosa na transação, então o limite global de ociosidade não pode matá-la.
    await client.query("set local idle_in_transaction_session_timeout = '30min'");
    const got = (await client.query("select pg_try_advisory_xact_lock($1::bigint) as ok", [lockKey(name)])).rows[0] as { ok: boolean };
    if (!got.ok) { await client.query("rollback"); return { ran: false }; }
    try { return { ran: true, value: await fn() }; }
    finally { await client.query("rollback"); }
  } finally { client.release(); }
}
