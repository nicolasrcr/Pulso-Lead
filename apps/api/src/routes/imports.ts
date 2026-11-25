import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { can, parseCsv, parseImportRow } from "@pulso/domain";
import { tx, UUID_RE } from "../db.ts";
import { granteeIn, need, HttpError } from "../authz.ts";
import type { CpfVault } from "../auth/cpf-vault.ts";

const MAX_ROWS = 5000;
const PG_MSG: Record<string, string> = { "23503": "plano ou afiliado não pertence ao projeto", "22023": "valor inválido", "42501": "sem acesso ao projeto" };

export function registerImportRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler, vault: CpfVault) {
  const project = (req: { projectId?: string }) => {
    if (!req.projectId) throw new HttpError(400, "project_required");
    return req.projectId;
  };

  // Migração de pedidos por CSV. Idempotente por id_externo: reenviar o mesmo arquivo não duplica nem recontabiliza.
  app.post<{ Body: { csv?: string; source?: string } }>("/v1/imports", { preHandler: authenticate, bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    const pid = project(req);
    const { csv, source = "csv" } = req.body ?? {};
    if (typeof csv !== "string" || !csv.trim()) return reply.code(400).send({ error: "invalid_csv" });
    if (typeof source !== "string" || source.length > 40) return reply.code(400).send({ error: "invalid_source" });
    let rows: Record<string, string>[];
    try { rows = parseCsv(csv, { maxRows: MAX_ROWS }); } catch (e) { return reply.code(400).send({ error: "invalid_csv", detail: (e as Error).message }); }
    if (rows.length === 0) return reply.code(400).send({ error: "empty_csv" });

    const result = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      const g = await granteeIn(c, req.userId!, pid);
      need(g, "orders.edit", "orders.create");
      // Marcar como pago credita comissão: exige a mesma capability da transição manual de pagamento.
      const canMarkPaid = can(g, "orders.status.all") || can(g, "billing.status");
      const batch = (await c.query(
        `insert into import_batches (organization_id, project_id, source, status, created_by)
         select organization_id, id, $2, 'processing', $3 from projects where id = $1 returning id`, [pid, source, req.userId])).rows[0] as { id: string };
      const stats = { total: rows.length, created: 0, duplicates: 0, failed: 0, errors: [] as { row: number; error: string }[] };
      for (const [i, raw] of rows.entries()) {
        const line = i + 2; // linha 1 = cabeçalho
        const p = parseImportRow(raw);
        if (!p.ok) { stats.failed++; if (stats.errors.length < 50) stats.errors.push({ row: line, error: p.error }); continue; }
        const v = p.value;
        if (v.paid && !canMarkPaid) { stats.failed++; if (stats.errors.length < 50) stats.errors.push({ row: line, error: "sem permissão para importar pedido já pago" }); continue; }
        await c.query("savepoint row_sp");
        try {
          const customer = { name: v.name, phone: v.phone ?? null, email: v.email ?? null, address: v.uf ? { uf: v.uf } : {}, cpf_hash: v.cpf ? vault.hash(v.cpf) : null };
          const price = (await c.query("select price_cents from product_plans where id = $1", [v.planId])).rows[0] as { price_cents: number } | undefined;
          const r = ((await c.query("select app.create_order($1,$2,$3,$4::jsonb,$5,$6,true,null,$7,'imported',$8) as r", [
            pid, v.planId, v.affiliateId ?? null, JSON.stringify(customer), v.cpf ? vault.encrypt(v.cpf) : null, v.totalCents ?? price?.price_cents ?? 0, v.externalId, batch.id])).rows[0] as { r: { id: string; created: boolean } }).r;
          if (!r.created) stats.duplicates++;
          else {
            stats.created++;
            if (v.paid) {
              await c.query("select app.transition_order($1,'payment','sem_status','pendente',now(),$2)", [r.id, req.userId]);
              await c.query("select app.transition_order($1,'payment','pendente','pago',now(),$2)", [r.id, req.userId]);
            }
          }
          await c.query("release savepoint row_sp");
        } catch (e) {
          await c.query("rollback to savepoint row_sp");
          stats.failed++;
          if (stats.errors.length < 50) stats.errors.push({ row: line, error: PG_MSG[(e as { code?: string }).code ?? ""] ?? "erro ao importar" });
        }
      }
      await c.query("update import_batches set status = 'done', stats = $2::jsonb where id = $1", [batch.id, JSON.stringify(stats)]);
      return { id: batch.id, ...stats };
    });
    return reply.code(201).send(result);
  });

  app.get<{ Params: { id: string } }>("/v1/imports/:id", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_import" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "orders.edit", "orders.create");
      const r = (await c.query("select id, source, status, stats, created_at as \"createdAt\" from import_batches where id = $1", [req.params.id])).rows[0];
      if (!r) throw new HttpError(404, "not_found");
      return r;
    });
  });
}
