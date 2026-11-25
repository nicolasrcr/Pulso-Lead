import { type Grantee, type Role } from "@pulso/domain";

export interface MembershipRow { role: Role; capabilities: string[]; project_id: string | null; organization_id: string; approved_at: Date | null }
const RANK: Record<Role, number> = { affiliate: 0, operator: 1, project_admin: 2, org_admin: 3 };

/** Papel e capabilities do usuário em um projeto: org_admin (project_id nulo) vale para todos; demais, só o próprio projeto. */
export function granteeForProject(
  memberships: readonly MembershipRow[],
  platformAdmin: boolean,
  project: { id: string; organization_id: string },
): Grantee {
  const mine = memberships.filter(
    (m) => m.approved_at && m.organization_id === project.organization_id && (m.project_id === null || m.project_id === project.id),
  );
  let role: Role = "affiliate";
  const caps = new Set<string>();
  for (const m of mine) {
    if (RANK[m.role] > RANK[role]) role = m.role;
    for (const c of m.capabilities) caps.add(c);
  }
  return { role, capabilities: [...caps], platformAdmin };
}
