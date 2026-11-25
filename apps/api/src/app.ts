import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
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
import { registerConnectorRoutes } from "./routes/connectors.ts";
import { registerBackofficeRoutes } from "./routes/backoffice.ts";
import { registerExportRoutes } from "./routes/export.ts";
import { consoleReporter, newRequestId, scrub, type ErrorReporter } from "./observability.ts";
import { makeCarrierFactory, type CarrierFactory } from "./carriers.ts";

const TEMPLATES = { [posPagoV1.key]: posPagoV1 } as const;

declare module "fastify" {
  interface FastifyRequest { userId?: string; projectId?: string }
}

export interface AppDeps { pool?: pg.Pool; cpfKey?: string; rateLimit?: { authPerMin: number; publicPerMin: number }; systemUserId?: string; carriers?: CarrierFactory; labelBaseUrl?: string; reporter?: ErrorReporter; corsOrigins?: string[] }

export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false, maxParamLength: 256, genReqId: () => newRequestId() });

  // Cabeçalhos de segurança em toda resposta (API JSON/CSV: sem HTML servido, CSP restritiva não atrapalha).
  void app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: "same-site" } });
  // CORS só para as origens configuradas (CORS_ORIGINS); sem lista, só mesma origem (proxy do front).
  if (deps.corsOrigins?.length) void app.register(cors, { origin: deps.corsOrigins, methods: ["GET", "POST", "PATCH", "DELETE"], allowedHeaders: ["authorization", "content-type", "x-project-id"], maxAge: 600 });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.error });
    const mapped = httpFromPg(err);
    if (mapped) return reply.code(mapped.status).send({ error: mapped.error });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: "bad_request" });
    (deps.reporter ?? consoleReporter)({ requestId: String(_req.id), method: _req.method, url: scrub(_req.url), message: (err as Error).message, stack: (err as Error).stack });
    return reply.code(500).header("x-request-id", String(_req.id)).send({ error: "internal_error", requestId: String(_req.id) });
  });

  // Limites de taxa por IP (login/cadastro e links públicos). Desligado quando `rateLimit` não é informado (testes).
  if (deps.rateLimit) {
    const auth = makeLimiter(deps.rateLimit.authPerMin, 60_000), pub = makeLimiter(deps.rateLimit.publicPerMin, 60_000);
    app.addHook("onRequest", async (req, reply) => {
      const url = req.url.split("?")[0] ?? "";
      const lim = url === "/v1/auth/login" || url === "/v1/auth/register" ? auth : url.startsWith("/v1/links/") || url.startsWith("/v1/track/") || url.startsWith("/v1/hooks/") ? pub : null;
      if (lim && !lim.take(`${url.startsWith("/v1/") && lim === pub ? "p" : "a"}:${req.ip}`)) return reply.code(429).header("retry-after", "60").send({ error: "too_many_requests" });
    });
  }

  app.addHook("onSend", async (req, reply) => { reply.header("x-request-id", String(req.id)); });
  app.get("/health", async () => ({ status: "ok" }));
  // Prontidão: confirma que o banco responde (usado pelo orquestrador; /health só diz que o processo vive).
  app.get("/ready", async (_req, reply) => {
    if (!deps.pool) return reply.code(503).send({ status: "no_database" });
    try { await deps.pool.query("select 1"); return { status: "ready" }; } catch { return reply.code(503).send({ status: "database_unavailable" }); }
  });
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
    const vault = makeCpfVault(deps.cpfKey ?? "");
    registerImportRoutes(app, pool, authenticate, vault);
    const integrationBox = makeSecretBox(deps.cpfKey ?? "", "integration:secret");
    const carriers = deps.carriers ?? makeCarrierFactory(integrationBox, { labelBaseUrl: deps.labelBaseUrl ?? "https://labels.invalid/l" });
    registerBackofficeRoutes(app, pool, authenticate);
    registerExportRoutes(app, pool, authenticate);
    registerConnectorRoutes(app, pool, authenticate, { box: integrationBox, vault, carriers, systemUserId: deps.systemUserId });
    registerOrderRoutes(app, pool, authenticate, makeCpfVault(deps.cpfKey ?? ""));
  }
  return app;
}
