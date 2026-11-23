import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type pg from "pg";
import { posPagoV1 } from "@pulso/templates";
import { hashToken } from "./auth/token.ts";
import { tx, UUID_RE, httpFromPg } from "./db.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerMembershipRoutes } from "./routes/memberships.ts";

const TEMPLATES = { [posPagoV1.key]: posPagoV1 } as const;

declare module "fastify" {
  interface FastifyRequest { userId?: string; projectId?: string }
}

export interface AppDeps { pool?: pg.Pool }

export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    const mapped = httpFromPg(err);
    if (mapped) return reply.code(mapped.status).send({ error: mapped.error });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: "bad_request" });
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get<{ Params: { key: string } }>("/v1/templates/:key", async (req, reply) => {
    const t = (TEMPLATES as Record<string, unknown>)[req.params.key];
    if (!t) return reply.code(404).send({ error: "template_not_found" });
    return t;
  });

  const pool = deps.pool;
  if (pool) {
    // Autenticação por token opaco; projeto opcional em x-project-id (validado contra o acesso real).
    const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
      if (!m) return reply.code(401).send({ error: "unauthorized" });
      const r = await pool.query("select app.session_user($1) as id", [hashToken(m[1]!)]);
      const userId = r.rows[0]?.id as string | null;
      if (!userId) return reply.code(401).send({ error: "unauthorized" });
      req.userId = userId;
      const pid = req.headers["x-project-id"];
      if (pid !== undefined) {
        if (typeof pid !== "string" || !UUID_RE.test(pid)) return reply.code(400).send({ error: "invalid_project_id" });
        const ok = await tx(pool, { userId }, async (c) => (await c.query("select app.can_access_project($1) as ok", [pid])).rows[0] as { ok: boolean });
        if (!ok.ok) return reply.code(403).send({ error: "forbidden" });
        req.projectId = pid;
      }
    };
    registerAuthRoutes(app, pool, authenticate);
    registerProjectRoutes(app, pool, authenticate);
    registerMembershipRoutes(app, pool, authenticate);
  }
  return app;
}
