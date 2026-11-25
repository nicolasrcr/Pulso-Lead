import type { Queryable } from "../tenant.ts";
import type { CpfVault } from "../auth/cpf-vault.ts";
import { mapSale, type Provider } from "./mappers.ts";

export type SaleOutcome = "processed" | "unlinked" | "failed" | "ignored";

/**
 * Processa um evento cru já gravado: resolve plano/afiliado pelos vínculos, cria o pedido (idempotente por external_id)
 * e aplica pagamento/cancelamento. Sem vínculo de produto → 'unlinked' (nada é inventado; reprocessável depois).
 * Roda dentro de transação de tenant do chamador.
 */
export async function processSaleEvent(c: Queryable, vault: CpfVault, actorId: string, eventRowId: string): Promise<SaleOutcome> {
  const ev = (await c.query("select id, project_id, provider, payload, status from webhook_events_raw where id = $1 for update", [eventRowId])).rows[0] as
    { id: string; project_id: string; provider: Provider; payload: unknown; status: string } | undefined;
  if (!ev) return "ignored";
  if (ev.status === "processed") return "ignored";
  const finish = async (s: "processed" | "failed" | "unlinked") => { await c.query("select app.finish_sale_event($1,$2)", [ev.id, s]); return s; };

  const sale = mapSale(ev.provider, ev.payload);
  if (!sale) return finish("failed");

  const link = (await c.query("select plan_id from external_product_links where project_id = $1 and provider = $2 and external_product_id = $3",
    [ev.project_id, ev.provider, sale.externalProductId])).rows[0] as { plan_id: string } | undefined;
  if (!link) return finish("unlinked");

  const existing = (await c.query("select id from orders where project_id = $1 and external_id = $2", [ev.project_id, sale.externalOrderId])).rows[0] as { id: string } | undefined;
  let orderId = existing?.id;
  if (!orderId) {
    if (sale.paymentStatus === "cancelado") return finish("processed"); // cancelamento de pedido que nunca chegou: nada a fazer
    const aff = sale.affiliateEmail
      ? (await c.query("select affiliate_id from affiliate_email_links where project_id = $1 and provider = $2 and email = $3", [ev.project_id, ev.provider, sale.affiliateEmail])).rows[0] as { affiliate_id: string } | undefined
      : undefined;
    const customer = { name: sale.customer.name, phone: sale.customer.phone, email: sale.customer.email, address: {}, cpf_hash: sale.customer.cpf ? vault.hash(sale.customer.cpf) : null };
    const r = (await c.query("select app.create_order($1,$2,$3,$4::jsonb,$5,$6,true,null,$7,'created',null) as r", [
      ev.project_id, link.plan_id, aff?.affiliate_id ?? null, JSON.stringify(customer), sale.customer.cpf ? vault.encrypt(sale.customer.cpf) : null,
      sale.totalCents, sale.externalOrderId])).rows[0] as { r: { id: string } };
    orderId = r.r.id;
  }

  const st = (await c.query("select platform_status, payment_status from order_status where order_id = $1", [orderId])).rows[0] as { platform_status: string; payment_status: string };
  const tr = (axis: string, from: string, to: string) => c.query("select app.transition_order($1,$2,$3,$4,now(),$5) as ok", [orderId, axis, from, to, actorId]);
  if (sale.paymentStatus === "pago") {
    let cur = st.payment_status;
    if (cur === "sem_status") { await tr("payment", "sem_status", "pendente"); cur = "pendente"; }
    if (cur === "pendente" || cur === "parcial") await tr("payment", cur, "pago");
  } else if (sale.paymentStatus === "cancelado" && st.platform_status === "criado") {
    await tr("platform", "criado", "cancelado_sem_custo");
  }
  return finish("processed");
}
