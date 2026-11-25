import { useState } from "react";
import { formatBrl } from "../format";
import { buildCommissionRule, describeRule, parseMoneyToCents } from "../rules";
import { ActionMsg, Badge, Button, Card, Field, Input, Notice, Select, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

export function Catalogo({ api, projectId, caps }: PageProps) {
  const cat = useLoad(() => api.products(), [api, projectId]);
  const stock = useLoad(() => api.stockItems().catch(() => ({ items: [] })), [api, projectId]);
  const canManage = caps.includes("products.manage");
  const pAct = useAction(), plAct = useAction();
  const [p, setP] = useState({ name: "", sku: "" });
  const [pl, setPl] = useState({ productId: "", name: "", price: "", ruleType: "percent" as "percent" | "fixed", rule: "", stockItemId: "", qty: "1" });
  const price = parseMoneyToCents(pl.price);
  const rule = buildCommissionRule(pl.ruleType, pl.rule);
  const qty = Number(pl.qty);
  const planValid = !!pl.productId && !!pl.name && price !== null && rule !== null && (!pl.stockItemId || (Number.isInteger(qty) && qty > 0));
  const products = cat.data?.products ?? [];
  return (
    <div>
      {cat.error && <Notice kind="error">{cat.error}</Notice>}
      <Card title="Produtos e planos">
        <Table rows={products} rowKey={(x) => x.id} empty="Nenhum produto." cols={[
          { head: "Produto", cell: (x) => <>{x.name} {x.private && <Badge tone="warn">Privado</Badge>}</> }, { head: "SKU", cell: (x) => x.sku ?? "—" },
          { head: "Planos", cell: (x) => (cat.data?.plans.filter((y) => y.productId === x.id) ?? []).map((y) => <div key={y.id}>{y.name} — {formatBrl(y.priceCents)} · comissão {describeRule(y.commissionRule as never)}{y.bom.length > 0 && ` · BOM ${y.bom.length} item(ns)`}</div>) },
        ]} />
      </Card>
      {canManage && <>
        <Card title="Novo produto">
          <form onSubmit={(e) => { e.preventDefault(); pAct.run(async () => { await api.createProduct(p.name, p.sku || undefined); setP({ name: "", sku: "" }); cat.reload(); }, "Produto criado."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
            <Field label="Nome"><Input required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="SKU"><Input value={p.sku} onChange={(e) => setP({ ...p, sku: e.target.value })} /></Field>
            <Button type="submit" disabled={pAct.busy || !p.name}>Criar</Button>
          </form><ActionMsg msg={pAct.msg} />
        </Card>
        <Card title="Novo plano">
          <form onSubmit={(e) => { e.preventDefault(); if (price === null || rule === null) return; plAct.run(async () => {
            await api.createPlan(pl.productId, { name: pl.name, priceCents: price, commissionRule: rule, bom: pl.stockItemId ? [{ stockItemId: pl.stockItemId, qty }] : [] });
            setPl({ ...pl, name: "", price: "", rule: "" }); cat.reload();
          }, "Plano criado."); }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "var(--space-3)" }}>
              <Field label="Produto"><Select required value={pl.productId} onChange={(e) => setPl({ ...pl, productId: e.target.value })}><option value="">Selecione…</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Nome do plano"><Input required value={pl.name} onChange={(e) => setPl({ ...pl, name: e.target.value })} /></Field>
              <Field label="Preço (R$)"><Input value={pl.price} inputMode="decimal" onChange={(e) => setPl({ ...pl, price: e.target.value })} aria-invalid={pl.price !== "" && price === null} /></Field>
              <Field label="Comissão"><Select value={pl.ruleType} onChange={(e) => setPl({ ...pl, ruleType: e.target.value as "percent" | "fixed" })}><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></Select></Field>
              <Field label={pl.ruleType === "percent" ? "Percentual" : "Valor (R$)"}><Input value={pl.rule} inputMode="decimal" onChange={(e) => setPl({ ...pl, rule: e.target.value })} aria-invalid={pl.rule !== "" && rule === null} /></Field>
              <Field label="Item de estoque (BOM)"><Select value={pl.stockItemId} onChange={(e) => setPl({ ...pl, stockItemId: e.target.value })}><option value="">Nenhum</option>{stock.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.sku})</option>)}</Select></Field>
              {pl.stockItemId && <Field label="Qtd por pedido"><Input value={pl.qty} inputMode="numeric" onChange={(e) => setPl({ ...pl, qty: e.target.value })} /></Field>}
            </div>
            {rule && <p>Comissão: {describeRule(rule as never)}</p>}
            <Button type="submit" disabled={plAct.busy || !planValid}>Criar plano</Button>
          </form><ActionMsg msg={plAct.msg} />
        </Card>
      </>}
    </div>
  );
}
