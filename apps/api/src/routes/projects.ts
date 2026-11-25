import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { can } from "@pulso/domain";
import { tx, UUID_RE } from "../db.ts";
import { granteeForProject, type MembershipRow } from "../auth/grantee.ts";

export function registerProjectRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  // RLS decide o que aparece; com x-project-id, só aquele projeto.
  app.get("/v1/projects", { preHandler: authenticate }, async (req) =>
    tx(pool, { userId: req.userId!, projectId: req.projectId }, async (c) => ({
      projects: (await c.query("select id, organization_id as \"organizationId\", name, template_key as \"templateKey\" from projects order by name")).rows,
    })),
  );

  app.post<{ Body: { organizationId?: string; name?: string; templateKey?: string; templateVersion?: number } }>(
    "/v1/projects", { preHandler: authenticate }, async (req, reply) => {
      const { organizationId, name, templateKey = "pos-pago", templateVersion = 1 } = req.body ?? {};
      if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) return reply.code(400).send({ error: "invalid_organization" });
      if (typeof name !== "string" || !name.trim() || name.length > 120) return reply.code(400).send({ error: "invalid_name" });
      const id = await tx(pool, { userId: req.userId! }, async (c) =>
        ((await c.query("select app.create_project($1, $2, $3, $4) as id", [organizationId, name, templateKey, templateVersion])).rows[0] as { id: string }).id);
      return reply.code(201).send({ id });
    },
  );

  // Equipe do projeto: exige users.manage NO PROJETO (checado no servidor) e o RLS filtra as linhas.
  app.get<{ Params: { id: string } }>("/v1/projects/:id/members", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: "invalid_project_id" });
    return tx(pool, { userId: req.userId! }, async (c) => {
      const proj = (await c.query("select id, organization_id from projects where id = $1", [id])).rows[0] as { id: string; organization_id: string } | undefined;
      if (!proj) return reply.code(403).send({ error: "forbidden" }); // projeto inacessível = 403, igual a x-project-id
      const me = (await c.query("select platform_admin from app_users where id = $1", [req.userId])).rows[0] as { platform_admin: boolean };
      const ms = (await c.query("select organization_id, project_id, role, capabilities, approved_at from memberships where user_id = $1", [req.userId])).rows as MembershipRow[];
      if (!can(granteeForProject(ms, me.platform_admin, proj), "users.manage")) return reply.code(403).send({ error: "forbidden" });
      const rows = (await c.query(
        `select m.id, m.user_id as "userId", u.email, u.name, m.role, m.capabilities, m.project_id as "projectId",
                (m.approved_at is not null) as approved
           from memberships m join app_users u on u.id = m.user_id
          where m.organization_id = $2 and (m.project_id = $1 or m.project_id is null)
          order by u.name`, [id, proj.organization_id])).rows;
      return { members: rows };
    });
  });
}
