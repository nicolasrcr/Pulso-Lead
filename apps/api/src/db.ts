import pg from "pg";
import { withTenant } from "./tenant.ts";
import type { Queryable } from "./tenant.ts";

export interface Ctx { userId: string; projectId?: string }

/** Conexão do pool + transação com contexto de tenant (RLS). */
export async function tx<T>(pool: pg.Pool, ctx: Ctx, fn: (c: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await withTenant(client, ctx, fn); }
  finally { client.release(); }
}

const posInt = (v: string | undefined, d: number) => (v !== undefined && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : d);

/** Pool com limites: evita conexões penduradas, consultas descontroladas e transações abandonadas. Ajustável por PG_*. */
export function makePool(connectionString: string, env: Record<string, string | undefined> = process.env): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: posInt(env.PG_POOL_MAX, 10),
    idleTimeoutMillis: posInt(env.PG_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: posInt(env.PG_CONNECT_TIMEOUT_MS, 5_000),
    statement_timeout: posInt(env.PG_STATEMENT_TIMEOUT_MS, 30_000),
    idle_in_transaction_session_timeout: posInt(env.PG_IDLE_TX_TIMEOUT_MS, 60_000),
    application_name: "pulso-api",
  });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function httpFromPg(e: unknown): { status: number; error: string } | null {
  const code = (e as { code?: string })?.code;
  switch (code) {
    case "42501": return { status: 403, error: "forbidden" };
    case "23505": return { status: 409, error: "conflict" };
    case "22023": case "23514": case "23503": case "22P02": return { status: 400, error: "invalid_request" };
    case "55000": return { status: 409, error: "invalid_state" };
    case "55006": return { status: 423, error: "organization_suspended" };
    case "02000": return { status: 404, error: "not_found" };
    default: return null;
  }
}
