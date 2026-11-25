import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { toCsv, maskPhone } from "@pulso/domain";
import { tx } from "../db.ts";
import { granteeIn, need, HttpError } from "../authz.ts";
import { audit } from "../audit.ts";

/**
 * Exportação self-service (portabilidade). Funciona com a organização suspensa (somente leitura).
 * Sem CPF e com telefone mascarado: o CPF só sai por `reveal-cpf`, que é auditado pedido a pedido.
 */
export function registerExportRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  const pid = (req: { projectId?: string }) => { if (!req.projectId) throw new HttpError(400, "project_required"); return req.projectId; };

  app.get("/v1/export/orders.csv", { preHandler: authenticate }, async (req, reply) => {
    const p = pid(req);
    const csv = await tx(pool, { userId: req.userId!, projectId: p }, async (c) => {
      need(await granteeIn(c, req.userId!, p), "orders.read_all");
      const rows = (await c.query(`select o.id, o.external_id, o.created_at::text as criado_em, cu.name as cliente, cu.phone as telefone,
          o.total_cents as total_centavos, s.platform_status as plataforma, s.shipping_status as transporte, s.payment_status as pagamento,
          o.tracking_code as rastreio, a.name as afiliado
        from orders o join order_status s on s.order_id = o.id left join customers cu on cu.id = o.customer_id left join affiliates a on a.id = o.affiliate_id
        order by o.created_at, o.id`)).rows as Record<string, unknown>[];
      await audit(c, req.userId!, p, "export.orders", "project", p, { rows: rows.length });
      return toCsv(rows.map((r) => ({ ...r, telefone: r.telefone ? maskPhone(String(r.telefone)) : "" })),
        ["id", "external_id", "criado_em", "cliente", "telefone", "total_centavos", "plataforma", "transporte", "pagamento", "rastreio", "afiliado"]);
    });
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="pedidos.csv"').send(csv);
  });

  app.get("/v1/export/ledger.csv", { preHandler: authenticate }, async (req, reply) => {
    const p = pid(req);
    const csv = await tx(pool, { userId: req.userId! , projectId: p }, async (c) => {
      need(await granteeIn(c, req.userId!, p), "reports.read");
      const rows = (await c.query(`select l.id, l.order_id, l.kind, l.amount_cents as valor_centavos, l.created_at::text as criado_em, a.name as afiliado
        from commission_ledger l left join affiliates a on a.id = l.affiliate_id order by l.id`)).rows as Record<string, unknown>[];
      await audit(c, req.userId!, p, "export.ledger", "project", p, { rows: rows.length });
      return toCsv(rows, ["id", "order_id", "kind", "valor_centavos", "criado_em", "afiliado"]);
    });
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="comissoes.csv"').send(csv);
  });
}
