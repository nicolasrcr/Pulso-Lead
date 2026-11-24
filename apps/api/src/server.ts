import { startJobs } from "./jobs.ts";
import { makeSecretBox } from "./webhooks/secret-box.ts";
import pg from "pg";
import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
// DATABASE_URL deve usar o papel app_user (sem BYPASSRLS). Nunca o dono do schema.
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : undefined;
if (!pool) console.warn("DATABASE_URL ausente: só /health e /v1/templates estão ativos");
if (pool && !process.env.CPF_KEY) throw new Error("CPF_KEY ausente (64 hex): gere com `openssl rand -hex 32`");
const app = buildApp({ pool, cpfKey: process.env.CPF_KEY, rateLimit: { authPerMin: 20, publicPerMin: 120 } });
if (pool && process.env.SYSTEM_USER_ID && process.env.CPF_KEY) {
  startJobs(pool, { systemUserId: process.env.SYSTEM_USER_ID, secretBox: makeSecretBox(process.env.CPF_KEY) });
} else if (pool) console.warn("SYSTEM_USER_ID ausente: jobs (webhooks, dashboards, inadimplência) desativados");
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`api em :${port}`));
