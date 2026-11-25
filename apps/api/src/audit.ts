import type { Queryable } from "./tenant.ts";

/** Trilha por projeto (audit_log). Nunca grave segredo ou PII em `meta`. */
export async function audit(c: Queryable, actorId: string, projectId: string, action: string, entity?: string, entityId?: string, meta: Record<string, unknown> = {}): Promise<void> {
  await c.query(
    `insert into audit_log (organization_id, project_id, actor_id, action, entity, entity_id, meta)
     select organization_id, id, $2, $3, $4, $5, $6::jsonb from projects where id = $1`,
    [projectId, actorId, action, entity ?? null, entityId ?? null, JSON.stringify(meta)]);
}
