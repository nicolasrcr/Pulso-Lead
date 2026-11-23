// Lint estático: toda tabela com project_id precisa ter RLS habilitada, forçada e uma policy em 0004+.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../db/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");

const tables = [...sql.matchAll(/create table (\w+) \(([\s\S]*?)\n\);/g)]
  .filter(([, , body]) => /\bproject_id\b/.test(body))
  .map(([, name]) => name);

const problems = [];
for (const t of tables) {
  if (!new RegExp(`alter table ${t} enable row level security`).test(sql)) problems.push(`${t}: sem ENABLE RLS`);
  if (!new RegExp(`alter table ${t} force row level security`).test(sql)) problems.push(`${t}: sem FORCE RLS`);
  if (!new RegExp(`create policy \\w+ on ${t}\\b`).test(sql)) problems.push(`${t}: sem policy`);
}
// Dinheiro nunca em float/numeric/money
for (const m of sql.matchAll(/(\w+_cents)\s+(\w+)/g)) {
  if (!/^(int|integer|bigint)$/.test(m[2])) problems.push(`${m[1]}: dinheiro deve ser inteiro (achou ${m[2]})`);
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`ok: ${tables.length} tabelas com project_id cobertas por RLS`);
