import Fastify, { type FastifyInstance } from "fastify";
import { posPagoV1 } from "@pulso/templates";

const TEMPLATES = { [posPagoV1.key]: posPagoV1 } as const;

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok" }));
  app.get<{ Params: { key: string } }>("/v1/templates/:key", async (req, reply) => {
    const t = (TEMPLATES as Record<string, unknown>)[req.params.key];
    if (!t) return reply.code(404).send({ error: "template_not_found" });
    return t;
  });
  return app;
}
