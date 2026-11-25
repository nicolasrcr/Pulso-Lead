import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { CAPABILITIES, PRESETS, canGrant, type Role } from "@pulso/domain";
import { tx, UUID_RE } from "../db.ts";
import { granteeForProject, type MembershipRow } from "../auth/grantee.ts";

export function registerMembershipRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  app.post<{ Body: { organizationId?: string; projectId?: string; role?: string } }>("/v1/memberships", { preHandler: authenticate }, async (req, reply) => {
    const { organizationId, projectId, role } = req.body ?? {};
    if (typeof organizationId !== "string" || !UUID_RE.test(organizationId) || typeof projectId !== "string" || !UUID_RE.test(projectId))
      return reply.code(400).send({ error: "invalid_ids" });
    if (role !== "operator" && role !== "affiliate") return reply.code(400).send({ error: "invalid_role" });
    const id = await tx(pool, { userId: req.userId! }, async (c) =>
      ((await c.query("select app.request_membership($1, $2, $3) as id", [organizationId, projectId, role])).rows[0] as { id: string }).id);
    return reply.code(201).send({ id });
  });

  app.post<{ Params: { id: string }; Body: { preset?: string; capabilities?: string[] } }>("/v1/memberships/:id/approve", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: "invalid_id" });
    const { preset, capabilities } = req.body ?? {};
    const caps = new Set<string>();
    if (preset !== undefined) {
      const p = PRESETS[preset];
      if (!p) return reply.code(400).send({ error: "unknown_preset" });
      p.forEach((c) => caps.add(c));
    }
    if (capabilities !== undefined) {
      if (!Array.isArray(capabilities) || capabilities.some((c) => !(CAPABILITIES as readonly string[]).includes(c)))
        return reply.code(400).send({ error: "unknown_capability" });
      capabilities.forEach((c) => caps.add(c));
    }
    return tx(pool, { userId: req.userId! }, async (c) => {
      const target = (await c.query("select organization_id, project_id, role from memberships where id = $1", [id])).rows[0] as
        { organization_id: string; project_id: string | null; role: Role } | undefined;
      if (!target) return reply.code(404).send({ error: "not_found" });
      const me = (await c.query("select platform_admin from app_users where id = $1", [req.userId])).rows[0] as { platform_admin: boolean };
      const ms = (await c.query("select organization_id, project_id, role, capabilities, approved_at from memberships where user_id = $1", [req.userId])).rows as MembershipRow[];
      const grantor = granteeForProject(ms, me.platform_admin, { id: target.project_id ?? "", organization_id: target.organization_id });
      // Anti-escalada no servidor (o banco repete a checagem de papel).
      if (!canGrant(grantor, { role: target.role, capabilities: [...caps] })) return reply.code(403).send({ error: "forbidden" });
      await c.query("select app.approve_membership($1, $2)", [id, [...caps]]);
      return reply.code(204).send();
    });
  });

  app.post<{ Params: { id: string } }>("/v1/memberships/:id/reject", { preHandler: authenticate }, async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_id" });
    await tx(pool, { userId: req.userId! }, async (c) => { await c.query("select app.reject_membership($1)", [req.params.id]); });
    return reply.code(204).send();
  });
}
