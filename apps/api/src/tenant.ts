export interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> }

/**
 * Executa `fn` numa transação com o contexto de tenant (RLS).
 * `set_config(..., true)` vale só para a transação. Sem projectId = "Todos os projetos" do usuário.
 * A conexão deve usar o papel app_user (sem BYPASSRLS).
 */
export async function withTenant<T>(
  client: Queryable,
  ctx: { userId: string; projectId?: string },
  fn: (c: Queryable) => Promise<T>,
): Promise<T> {
  if (!ctx.userId) throw new Error("userId obrigatório: nunca execute sem identidade");
  await client.query("begin");
  try {
    await client.query("select set_config('app.user_id', $1, true), set_config('app.project_id', $2, true)", [ctx.userId, ctx.projectId ?? ""]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
