import { useState } from "react";
import { ActionMsg, Badge, Button, Card, Field, fmtDate, humanize, Input, Notice, Select, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

export function Estoque({ api, projectId, caps }: PageProps) {
  const list = useLoad(() => api.stockItems(), [api, projectId]);
  const [sel, setSel] = useState<string | null>(null);
  const mov = useLoad(() => (sel ? api.stockMovements(sel) : Promise.resolve({ movements: [] })), [api, sel]);
  const cAct = useAction(), aAct = useAction();
  const can = caps.includes("products.manage");
  const [n, setN] = useState({ sku: "", name: "", quantity: "0", minQuantity: "0" });
  const [adj, setAdj] = useState({ delta: "", reason: "adjust" as "adjust" | "purchase" | "loss" });
  const delta = Number(adj.delta);
  const items = list.data?.items ?? [];
  return (
    <div>
      {list.error && <Notice kind="error">{list.error}</Notice>}
      <Card title="Estoque">
        <Table rows={items} rowKey={(s) => s.id} empty="Nenhum item." cols={[
          { head: "SKU", cell: (s) => s.sku }, { head: "Item", cell: (s) => <button onClick={() => setSel(s.id)} style={{ all: "unset", cursor: "pointer", color: "var(--color-brand)" }}>{s.name}</button> },
          { head: "Saldo", align: "right", cell: (s) => s.quantity }, { head: "Mínimo", align: "right", cell: (s) => s.minQuantity },
          { head: "", cell: (s) => (s.quantity <= s.minQuantity ? <Badge tone="bad">Estoque baixo</Badge> : <Badge tone="ok">OK</Badge>) },
        ]} />
      </Card>
      {sel && <Card title={`Extrato — ${items.find((s) => s.id === sel)?.name ?? ""}`} actions={<Button kind="secondary" onClick={() => setSel(null)}>Fechar</Button>}>
        {can && <form onSubmit={(e) => { e.preventDefault(); aAct.run(async () => { await api.adjustStock(sel, delta, adj.reason); setAdj({ ...adj, delta: "" }); list.reload(); mov.reload(); }, "Ajuste registrado."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
          <Field label="Variação (+/−)"><Input value={adj.delta} inputMode="numeric" onChange={(e) => setAdj({ ...adj, delta: e.target.value })} /></Field>
          <Field label="Motivo"><Select value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value as typeof adj.reason })}><option value="adjust">Ajuste</option><option value="purchase">Compra</option><option value="loss">Perda</option></Select></Field>
          <Button type="submit" disabled={aAct.busy || !Number.isInteger(delta) || delta === 0}>Aplicar</Button>
        </form>}
        <ActionMsg msg={aAct.msg} />
        {mov.error && <Notice kind="error">{mov.error}</Notice>}
        <Table rows={mov.data?.movements ?? []} rowKey={(m) => String(m.id)} empty="Sem movimentações." cols={[
          { head: "Quando", cell: (m) => fmtDate(m.createdAt) }, { head: "Motivo", cell: (m) => humanize(m.reason) },
          { head: "Variação", align: "right", cell: (m) => (m.delta > 0 ? `+${m.delta}` : String(m.delta)) }, { head: "Pedido", cell: (m) => m.orderId?.slice(0, 8) ?? "—" },
        ]} />
      </Card>}
      {can && <Card title="Novo item">
        <form onSubmit={(e) => { e.preventDefault(); cAct.run(async () => { await api.createStockItem({ sku: n.sku, name: n.name, quantity: Number(n.quantity), minQuantity: Number(n.minQuantity) }); setN({ sku: "", name: "", quantity: "0", minQuantity: "0" }); list.reload(); }, "Item criado."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
          <Field label="SKU"><Input required value={n.sku} onChange={(e) => setN({ ...n, sku: e.target.value })} /></Field>
          <Field label="Nome"><Input required value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <Field label="Saldo inicial"><Input value={n.quantity} inputMode="numeric" onChange={(e) => setN({ ...n, quantity: e.target.value })} /></Field>
          <Field label="Mínimo"><Input value={n.minQuantity} inputMode="numeric" onChange={(e) => setN({ ...n, minQuantity: e.target.value })} /></Field>
          <Button type="submit" disabled={cAct.busy || !n.sku || !n.name || !Number.isInteger(Number(n.quantity)) || Number(n.quantity) < 0}>Criar</Button>
        </form><ActionMsg msg={cAct.msg} />
      </Card>}
    </div>
  );
}
