import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { tx, UUID_RE } from "../db.ts";
import { granteeIn, need, HttpError } from "../authz.ts";

const isInt = (v: unknown, min = 0) => Number.isInteger(v) && (v as number) >= min;
/** Mesma forma do CommissionRule do domínio: percentual em bps (0–10000) ou valor fixo em centavos. */
function validRule(r: unknown): boolean {
  const x = r as { type?: string; bps?: number; cents?: number } | null;
  if (!x || typeof x !== "object") return false;
  if (x.type === "percent") return Number.isInteger(x.bps) && x.bps! >= 0 && x.bps! <= 10_000;
  if (x.type === "fixed") return Number.isInteger(x.cents) && x.cents! >= 0;
  return false;
}
const str = (v: unknown, max = 120) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function registerCatalogRoutes(app: FastifyInstance, pool: pg.Pool, authenticate: preHandlerAsyncHookHandler) {
  const project = (req: { projectId?: string }) => {
    if (!req.projectId) throw new HttpError(400, "project_required");
    return req.projectId;
  };

  app.get("/v1/products", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      const g = await granteeIn(c, req.userId!, pid);
      need(g, "products.manage", "orders.create", "orders.edit", "orders.read_all", "dashboard.full");
      const products = (await c.query(`select id, name, sku, private, active from products order by name`)).rows;
      const plans = (await c.query(`select id, product_id as "productId", name, price_cents as "priceCents", commission_rule as "commissionRule", bom, active from product_plans order by name`)).rows;
      return { products, plans };
    });
  });

  app.post<{ Body: { name?: string; sku?: string; private?: boolean } }>("/v1/products", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const { name, sku, private: priv = false } = req.body ?? {};
    if (!str(name)) return reply.code(400).send({ error: "invalid_name" });
    const id = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "products.manage");
      return (await c.query(
        `insert into products (organization_id, project_id, name, sku, private)
         select organization_id, id, $2, $3, $4 from projects where id = $1 returning id`, [pid, name, sku ?? null, !!priv])).rows[0] as { id: string };
    });
    return reply.code(201).send(id);
  });

  app.post<{ Params: { id: string }; Body: { name?: string; priceCents?: number; commissionRule?: unknown; bom?: { stockItemId: string; qty: number }[] } }>(
    "/v1/products/:id/plans", { preHandler: authenticate }, async (req, reply) => {
      const pid = project(req);
      const { name, priceCents, bom = [], commissionRule = { type: "percent", bps: 0 } } = req.body ?? {};
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_product" });
      if (!str(name) || !isInt(priceCents)) return reply.code(400).send({ error: "invalid_plan" });
      if (!validRule(commissionRule)) return reply.code(400).send({ error: "invalid_commission_rule" });
      if (!Array.isArray(bom) || bom.some((b) => !UUID_RE.test(String(b?.stockItemId)) || !isInt(b?.qty, 1))) return reply.code(400).send({ error: "invalid_bom" });
      const id = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
        need(await granteeIn(c, req.userId!, pid), "products.manage");
        // A BOM só pode referenciar itens de estoque deste projeto (o RLS esconde os demais).
        const ids = [...new Set(bom.map((b) => b.stockItemId))];
        if (ids.length) {
          const found = (await c.query("select count(*)::int as n from stock_items where id = any($1::uuid[])", [ids])).rows[0] as { n: number };
          if (found.n !== ids.length) throw new HttpError(400, "invalid_bom");
        }
        const p = (await c.query("select organization_id, project_id from products where id = $1", [req.params.id])).rows[0] as { organization_id: string; project_id: string } | undefined;
        if (!p) throw new HttpError(404, "not_found");
        return (await c.query(
          `insert into product_plans (organization_id, project_id, product_id, name, price_cents, bom, commission_rule)
           values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) returning id`, [p.organization_id, p.project_id, req.params.id, name, priceCents, JSON.stringify(bom), JSON.stringify(commissionRule)])).rows[0] as { id: string };
      });
      return reply.code(201).send(id);
    });

  app.get("/v1/stock-items", { preHandler: authenticate }, async (req) => {
    const pid = project(req);
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "products.manage", "orders.edit", "orders.read_all", "dashboard.full");
      return { items: (await c.query(`select id, sku, name, quantity, min_quantity as "minQuantity" from stock_items order by sku`)).rows };
    });
  });

  // Extrato do item (somente leitura): últimos 200 movimentos, do mais novo ao mais antigo.
  app.get<{ Params: { id: string } }>("/v1/stock-items/:id/movements", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_item" });
    return tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "products.manage", "orders.edit", "orders.read_all", "dashboard.full");
      if (!(await c.query("select 1 from stock_items where id = $1", [req.params.id])).rows.length) throw new HttpError(404, "not_found");
      return { movements: (await c.query(
        `select id, delta, reason, order_id as "orderId", created_at as "createdAt" from stock_movements where stock_item_id = $1 order by id desc limit 200`, [req.params.id])).rows };
    });
  });

  app.post<{ Body: { sku?: string; name?: string; quantity?: number; minQuantity?: number } }>("/v1/stock-items", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const { sku, name, quantity = 0, minQuantity = 0 } = req.body ?? {};
    if (!str(sku, 60) || !str(name) || !isInt(quantity) || !isInt(minQuantity)) return reply.code(400).send({ error: "invalid_item" });
    const row = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "products.manage");
      const it = (await c.query(
        `insert into stock_items (organization_id, project_id, sku, name, quantity, min_quantity)
         select organization_id, id, $2, $3, $4, $5 from projects where id = $1 returning id, organization_id`, [pid, sku, name, quantity, minQuantity])).rows[0] as { id: string; organization_id: string };
      if (quantity > 0) await c.query(
        "insert into stock_movements (organization_id, project_id, stock_item_id, delta, reason) values ($1,$2,$3,$4,'initial')", [it.organization_id, pid, it.id, quantity]);
      return { id: it.id };
    });
    return reply.code(201).send(row);
  });

  // Ajuste manual (entrada/saída) com movimento rastreável; o saldo nunca fica negativo (CHECK no banco).
  app.post<{ Params: { id: string }; Body: { delta?: number; reason?: string } }>("/v1/stock-items/:id/adjust", { preHandler: authenticate }, async (req, reply) => {
    const pid = project(req);
    const { delta, reason = "adjust" } = req.body ?? {};
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: "invalid_item" });
    if (!Number.isInteger(delta) || delta === 0 || !["adjust", "purchase", "loss"].includes(reason)) return reply.code(400).send({ error: "invalid_adjust" });
    const out = await tx(pool, { userId: req.userId!, projectId: pid }, async (c) => {
      need(await granteeIn(c, req.userId!, pid), "products.manage");
      const r = (await c.query("update stock_items set quantity = quantity + $2 where id = $1 returning id, organization_id, quantity", [req.params.id, delta])).rows[0] as { id: string; organization_id: string; quantity: number } | undefined;
      if (!r) throw new HttpError(404, "not_found");
      await c.query("insert into stock_movements (organization_id, project_id, stock_item_id, delta, reason) values ($1,$2,$3,$4,$5)", [r.organization_id, pid, r.id, delta, reason]);
      return { quantity: r.quantity };
    });
    return out;
  });
}
