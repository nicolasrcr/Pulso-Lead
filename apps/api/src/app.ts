import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type pg from "pg";
import { posPagoV1 } from "@pulso/templates";
import { hashToken } from "./auth/token.ts";
import { tx, UUID_RE, httpFromPg } from "./db.ts";
import { HttpError } from "./authz.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerMembershipRoutes } from "./routes/memberships.ts";
import { registerCatalogRoutes } from "./routes/catalog.ts";
import { registerCommissionRoutes } from "./routes/commission.ts";
import { registerDashboardRoutes } from "./routes/dashboard.ts";
import { registerOrderRoutes } from "./routes/orders.ts";
import { makeCpfVault } from "./auth/cpf-vault.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";
import { registerImportRoutes } from "./routes/imports.ts";
import { makeSecretBox } from "./webhooks/secret-box.ts";
import { makeLimiter } from "./rate-limit.ts";

const TEMPLATES = { [posPagoV1.key]: posPagoV1 } as const;

declare module "fastify" {
  interface FastifyRequest { userId?: string; projectId?: string }
}

export interface AppDeps { pool?: pg.Pool; cpfKey?: string; rateLimit?: { authPerMin: number; publicPerMin: number } }

export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false, maxParamLength: 256 });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.error });
    const mapped = httpFromPg(err);
    if (mapped) return reply.code(mapped.status).send({ error: mapped.error });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: "bad_request" });
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  // Limites de taxa por IP (login/cadastro e links públicos). Desligado quando `rateLimit` não é informado (testes).
  if (deps.rateLimit) {
    const auth = makeLimiter(deps.rateLimit.authPerMin, 60_000), pub = makeLimiter(deps.rateLimit.publicPerMin, 60_000);
    app.addHook("onRequest", async (req, reply) => {
      const url = req.url.split("?")[0] ?? "";
      const lim = url === "/v1/auth/login" || url === "/v1/auth/register" ? auth : url.startsWith("/v1/links/") ? pub : null;
      if (lim && !lim.take(`${url.startsWith("/v1/links/") ? "l" : "a"}:${req.ip}`)) return reply.code(429).header("retry-after", "60").send({ error: "too_many_requests" });
    });
  }

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
    registerCatalogRoutes(app, pool, authenticate);
    registerCommissionRoutes(app, pool, authenticate);
    registerDashboardRoutes(app, pool, authenticate);
    registerWebhookRoutes(app, pool, authenticate, makeSecretBox(deps.cpfKey ?? ""));
    registerImportRoutes(app, pool, authenticate, makeCpfVault(deps.cpfKey ?? ""));
    registerOrderRoutes(app, pool, authenticate, makeCpfVault(deps.cpfKey ?? ""));
  }
  return app;
}
