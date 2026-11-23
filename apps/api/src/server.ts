import pg from "pg";
import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
// DATABASE_URL deve usar o papel app_user (sem BYPASSRLS). Nunca o dono do schema.
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : undefined;
if (!pool) console.warn("DATABASE_URL ausente: só /health e /v1/templates estão ativos");
buildApp({ pool }).listen({ port, host: "0.0.0.0" }).then(() => console.log(`api em :${port}`));
