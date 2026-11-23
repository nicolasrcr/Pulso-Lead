import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { hashPassword, validatePassword, verifyPassword } from "../auth/password.ts";
import { hashToken, newSessionToken } from "../auth/token.ts";
import { tx } from "../db.ts";
import { granteeForProject, type MembershipRow } from "../auth/grantee.ts";
import { effectiveCapabilities } from "@pulso/domain";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TTL = "12 hours";
let dummyHash: Promise<string> | null = null; // equaliza o tempo quando o e-mail não existe

export function registerAuthRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  app.post<{ Body: { email?: string; name?: string; password?: string } }>("/v1/auth/register", async (req, reply) => {
    const { email, name, password } = req.body ?? {};
    if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 200) return reply.code(400).send({ error: "invalid_email" });
    if (typeof name !== "string" || !name.trim() || name.length > 120) return reply.code(400).send({ error: "invalid_name" });
    if (!validatePassword(password ?? "")) return reply.code(400).send({ error: "weak_password" });
    try {
      const r = await pool.query("select app.register_user($1, $2, $3) as id", [email, name, await hashPassword(password!)]);
      return reply.code(201).send({ id: r.rows[0].id });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: "email_taken" });
      throw e;
    }
  });

  app.post<{ Body: { email?: string; password?: string } }>("/v1/auth/login", async (req, reply) => {
    const { email, password } = req.body ?? {};
    const invalid = () => reply.code(401).send({ error: "invalid_credentials" });
    if (typeof email !== "string" || typeof password !== "string") return invalid();
    const u = (await pool.query("select id, password_hash from app.auth_lookup($1)", [email])).rows[0] as { id: string; password_hash: string } | undefined;
    dummyHash ??= hashPassword("dummy-password-for-timing");
    const ok = await verifyPassword(password, u?.password_hash ?? (await dummyHash));
    if (!u || !ok) return invalid();
    const token = newSessionToken();
    const exp = await pool.query(`select app.session_create($1, $2, interval '${TTL}') as exp`, [u.id, hashToken(token)]);
    return { token, expiresAt: new Date(exp.rows[0].exp).toISOString() };
  });

  app.post("/v1/auth/logout", { preHandler: authenticate }, async (req, reply) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")![1]!;
    await pool.query("select app.session_revoke($1)", [hashToken(token)]);
    return reply.code(204).send();
  });

  app.get("/v1/me", { preHandler: authenticate }, async (req) => {
    const userId = req.userId!;
    return tx(pool, { userId }, async (c) => {
      const user = (await c.query("select id, email, name, platform_admin from app_users where id = $1", [userId])).rows[0] as
        { id: string; email: string; name: string; platform_admin: boolean };
      const ms = (await c.query(
        "select id, organization_id, project_id, role, capabilities, approved_at from memberships where user_id = $1 order by created_at", [userId],
      )).rows as (MembershipRow & { id: string })[];
      const projects = (await c.query("select id, organization_id, name from projects order by name")).rows as { id: string; organization_id: string; name: string }[];
      const capabilities: Record<string, string[]> = {};
      for (const p of projects) capabilities[p.id] = effectiveCapabilities(granteeForProject(ms, user.platform_admin, p));
      return {
        user: { id: user.id, email: user.email, name: user.name, platformAdmin: user.platform_admin },
        memberships: ms.map((m) => ({
          id: m.id, organizationId: m.organization_id, projectId: m.project_id, role: m.role,
          capabilities: m.capabilities, status: m.approved_at ? "approved" : "pending",
        })),
        projects: projects.map((p) => ({ id: p.id, organizationId: p.organization_id, name: p.name })),
        capabilities,
      };
    });
  });
}
