import { can, type Capability, type Grantee } from "@pulso/domain";
import type { Queryable } from "./tenant.ts";
import { granteeForProject, type MembershipRow } from "./auth/grantee.ts";

export class HttpError extends Error {
  constructor(public status: number, public error: string) { super(error); }
}

/** Papel/capabilities do usuário NO projeto (nunca confie na UI). Projeto inacessível = 403. */
export async function granteeIn(c: Queryable, userId: string, projectId: string): Promise<Grantee> {
  const proj = (await c.query("select id, organization_id from projects where id = $1", [projectId])).rows[0] as { id: string; organization_id: string } | undefined;
  if (!proj) throw new HttpError(403, "forbidden");
  const me = (await c.query("select platform_admin from app_users where id = $1", [userId])).rows[0] as { platform_admin: boolean };
  const ms = (await c.query("select organization_id, project_id, role, capabilities, approved_at from memberships where user_id = $1", [userId])).rows as MembershipRow[];
  return granteeForProject(ms, me.platform_admin, proj);
}

export function need(g: Grantee, ...anyOf: Capability[]): void {
  if (!anyOf.some((cap) => can(g, cap))) throw new HttpError(403, "forbidden");
}
