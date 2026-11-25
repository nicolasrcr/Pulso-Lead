import { startJobs } from "./jobs.ts";
import { makeSecretBox } from "./webhooks/secret-box.ts";
import { makePool } from "./db.ts";
import { buildApp } from "./app.ts";
import { makeCarrierFactory } from "./carriers.ts";

const port = Number(process.env.PORT ?? 3000);
// DATABASE_URL deve usar o papel app_user (sem BYPASSRLS). Nunca o dono do schema.
const pool = process.env.DATABASE_URL ? makePool(process.env.DATABASE_URL) : undefined;
if (!pool) console.warn("DATABASE_URL ausente: só /health e /v1/templates estão ativos");
if (pool && !process.env.CPF_KEY) throw new Error("CPF_KEY ausente (64 hex): gere com `openssl rand -hex 32`");
const labelBaseUrl = process.env.LABEL_BASE_URL ?? `http://localhost:${port}/v1/labels`;
const app = buildApp({ pool, cpfKey: process.env.CPF_KEY, rateLimit: { authPerMin: 20, publicPerMin: 120 }, systemUserId: process.env.SYSTEM_USER_ID, labelBaseUrl,
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean) });
if (pool && process.env.SYSTEM_USER_ID && process.env.CPF_KEY) {
  startJobs(pool, { systemUserId: process.env.SYSTEM_USER_ID, secretBox: makeSecretBox(process.env.CPF_KEY) },
    { carriers: makeCarrierFactory(makeSecretBox(process.env.CPF_KEY, "integration:secret"), { labelBaseUrl }) });
} else if (pool) console.warn("SYSTEM_USER_ID ausente: jobs (webhooks, dashboards, inadimplência) desativados");
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`api em :${port}`));
