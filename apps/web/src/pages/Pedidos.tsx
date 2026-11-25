import { useState } from "react";
import { posPagoV1 } from "@pulso/templates";
import type { OrderDetail } from "../api";
import { formatBrl } from "../format";
import { parseBrDateTimeLocal, parseMoneyToCents } from "../rules";
import { ActionMsg, Badge, Button, Card, Field, fmtDate, humanize, Input, Notice, Select, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

const label = (axis: "platform" | "payment" | "shipping", key: string) => posPagoV1.axes[axis].statuses.find((s) => s.key === key)?.label ?? humanize(key);
const nextOf = (axis: "platform" | "payment", from: string) => posPagoV1.axes[axis].transitions.filter((t) => t.from === from).map((t) => t.to);

export function Pedidos({ api, projectId, caps }: PageProps) {
  const list = useLoad(() => api.orders(), [api, projectId]);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const rows = (list.data?.orders ?? []).filter((o) => !q || `${o.customerName ?? ""} ${o.externalId ?? ""} ${o.id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <Card title="Pedidos" actions={<>
        {caps.includes("orders.create") && <Button onClick={() => setCreating((v) => !v)}>{creating ? "Fechar" : "Novo pedido"}</Button>}
        <Button kind="secondary" onClick={list.reload}>Atualizar</Button></>}>
        {creating && <NewOrder api={api} onDone={() => { setCreating(false); list.reload(); }} />}
        <Input aria-label="Buscar" placeholder="Buscar por cliente ou id externo" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: "var(--space-3)" }} />
        {list.error && <Notice kind="error">{list.error}</Notice>}
        <Table rows={rows} rowKey={(o) => o.id} empty="Nenhum pedido." cols={[
          { head: "Criado", cell: (o) => fmtDate(o.createdAt) }, { head: "Cliente", cell: (o) => <button onClick={() => setSel(o.id)} style={{ all: "unset", cursor: "pointer", color: "var(--color-brand)" }}>{o.customerName ?? "—"}</button> },
          { head: "Telefone", cell: (o) => o.customerPhone ?? "—" }, { head: "Total", align: "right", cell: (o) => formatBrl(o.totalCents) },
          { head: "Plataforma", cell: (o) => <Badge>{label("platform", o.platform)}</Badge> }, { head: "Pagamento", cell: (o) => <Badge tone={o.payment === "pago" ? "ok" : "muted"}>{label("payment", o.payment)}</Badge> },
          { head: "Transporte", cell: (o) => <Badge>{label("shipping", o.shipping)}</Badge> },
        ]} />
      </Card>
      {sel && <OrderPanel key={sel} api={api} id={sel} caps={caps} onClose={() => setSel(null)} onChanged={list.reload} />}
    </div>
  );
}

function NewOrder({ api, onDone }: { api: PageProps["api"]; onDone: () => void }) {
  const cat = useLoad(() => api.products(), [api]);
  const aff = useLoad(() => api.affiliates().catch(() => ({ affiliates: [] })), [api]);
  const act = useAction();
  const [f, setF] = useState({ planId: "", affiliateId: "", name: "", cpf: "", phone: "", email: "", total: "", zip: "", uf: "", city: "", street: "", number: "", district: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const total = f.total ? parseMoneyToCents(f.total) : undefined;
  return (
    <form onSubmit={(e) => { e.preventDefault(); act.run(async () => {
      await api.createOrder({ planId: f.planId, affiliateId: f.affiliateId || undefined, totalCents: total ?? undefined,
        customer: { name: f.name, cpf: f.cpf || undefined, phone: f.phone || undefined, email: f.email || undefined,
          address: { zip: f.zip, uf: f.uf.toUpperCase(), city: f.city, street: f.street, number: f.number, district: f.district } } });
      onDone();
    }, "Pedido criado."); }} style={{ marginBottom: "var(--space-4)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "var(--space-3)" }}>
        <Field label="Plano"><Select required value={f.planId} onChange={set("planId")}><option value="">Selecione…</option>{cat.data?.plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} — {formatBrl(p.priceCents)}</option>)}</Select></Field>
        <Field label="Afiliado (opcional)"><Select value={f.affiliateId} onChange={set("affiliateId")}><option value="">Nenhum</option>{aff.data?.affiliates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Total (vazio = preço do plano)"><Input value={f.total} onChange={set("total")} inputMode="decimal" placeholder="197,90" aria-invalid={f.total !== "" && total === null} /></Field>
        <Field label="Nome"><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label="CPF"><Input value={f.cpf} onChange={set("cpf")} inputMode="numeric" /></Field>
        <Field label="Telefone"><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="CEP"><Input value={f.zip} onChange={set("zip")} /></Field><Field label="UF"><Input maxLength={2} value={f.uf} onChange={set("uf")} /></Field>
        <Field label="Cidade"><Input value={f.city} onChange={set("city")} /></Field><Field label="Rua"><Input value={f.street} onChange={set("street")} /></Field>
        <Field label="Número"><Input value={f.number} onChange={set("number")} /></Field><Field label="Bairro"><Input value={f.district} onChange={set("district")} /></Field>
      </div>
      <Button type="submit" disabled={act.busy || (f.total !== "" && total === null)}>Criar pedido</Button><ActionMsg msg={act.msg} />
    </form>
  );
}

function OrderPanel({ api, id, caps, onClose, onChanged }: { api: PageProps["api"]; id: string; caps: string[]; onClose: () => void; onChanged: () => void }) {
  const d = useLoad(() => api.order(id), [api, id]);
  const act = useAction();
  const [cpf, setCpf] = useState<string | null>(null);
  const o = d.data;
  const refresh = () => { d.reload(); onChanged(); };
  const can = (c: string) => caps.includes(c);
  const doTransition = (axis: "platform" | "payment", from: string, to: string) => act.run(async () => { await api.transition(id, axis, from, to); refresh(); }, `${label(axis, to)}.`);
  return (
    <Card title={o ? `Pedido de ${o.customerName ?? "cliente"}` : "Pedido"} actions={<Button kind="secondary" onClick={onClose}>Fechar</Button>}>
      {d.error && <Notice kind="error">{d.error}</Notice>}
      <ActionMsg msg={act.msg} />
      {o && <>
        <p>Total <strong>{formatBrl(o.totalCents)}</strong> · {o.phone ?? "sem telefone"} · {o.email ?? "sem e-mail"} · CPF {cpf ?? o.cpf ?? "—"}{" "}
          {can("orders.edit") && o.cpf && !cpf && <Button kind="secondary" disabled={act.busy} onClick={() => act.run(async () => setCpf((await api.revealCpf(id)).cpf))}>Revelar (auditado)</Button>}</p>
        <p>Plataforma <Badge>{label("platform", o.platform)}</Badge> Pagamento <Badge>{label("payment", o.payment)}</Badge> Transporte <Badge>{label("shipping", o.shipping)}</Badge> {o.releasedAt ? <Badge tone="ok">Estoque liberado</Badge> : <Badge tone="warn">Estoque não liberado</Badge>}</p>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
          {can("orders.edit") && !o.releasedAt && <Button disabled={act.busy} onClick={() => act.run(async () => { await api.releaseOrder(id); refresh(); }, "Estoque liberado.")}>Liberar estoque</Button>}
          {(can("orders.status.all") || can("billing.status") || can("orders.status.own_after_delivery")) && nextOf("payment", o.payment).map((to) => <Button key={`p${to}`} kind="secondary" disabled={act.busy} onClick={() => doTransition("payment", o.payment, to)}>Pagamento → {label("payment", to)}</Button>)}
          {(can("orders.status.all") || can("orders.status.own_after_delivery")) && nextOf("platform", o.platform).map((to) => <Button key={`s${to}`} kind="secondary" disabled={act.busy} onClick={() => doTransition("platform", o.platform, to)}>Plataforma → {label("platform", to)}</Button>)}
          {can("orders.edit") && <>
            <Button kind="secondary" disabled={act.busy} onClick={() => act.run(async () => { await api.returnOrder(id, "returned"); refresh(); }, "Devolução registrada (estoque reposto).")}>Devolvido (repõe estoque)</Button>
            <Button kind="danger" disabled={act.busy} onClick={() => { if (confirm("Registrar como descartado? O estoque não será reposto.")) act.run(async () => { await api.returnOrder(id, "discarded"); refresh(); }, "Devolução registrada (descartado)."); }}>Descartado</Button>
            <Button kind="secondary" disabled={act.busy} onClick={() => act.run(async () => { await api.resendTracking(id); refresh(); }, "Rastreio reenviado.")}>Reenviar rastreio</Button></>}
        </div>
        {can("orders.edit") && <Shipment api={api} id={id} onDone={refresh} />}
        <h3>Histórico</h3>
        <Table rows={o.events} rowKey={(e) => `${e.at}${e.axis}${e.to}`} cols={[{ head: "Quando", cell: (e) => fmtDate(e.at) }, { head: "Eixo", cell: (e) => humanize(e.axis) }, { head: "De", cell: (e) => e.from ? humanize(e.from) : "—" }, { head: "Para", cell: (e) => humanize(e.to) }]} />
      </>}
    </Card>
  );
}

function Shipment({ api, id, onDone }: { api: PageProps["api"]; id: string; onDone: () => void }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [f, setF] = useState({ weight: "", l: "", w: "", h: "", nfNumber: "", nfSeries: "1", nfKey: "", nfDate: "", nfTax: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const issuedAt = parseBrDateTimeLocal(f.nfDate);
  const grams = Math.round(Number(f.weight.replace(",", ".")) * 1000);
  const valid = grams > 0 && Number(f.l) > 0 && Number(f.w) > 0 && Number(f.h) > 0 && /^\d{44}$/.test(f.nfKey) && !!issuedAt && !!f.nfNumber && /^\d{14}$/.test(f.nfTax.replace(/\D/g, ""));
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <Button kind="secondary" onClick={() => setOpen(!open)}>{open ? "Ocultar envio" : "Etiqueta / rastreio"}</Button>
      {open && <div style={{ marginTop: "var(--space-3)" }}>
        <ActionMsg msg={act.msg} />
        <form onSubmit={(e) => { e.preventDefault(); act.run(async () => {
          const r = await api.createShipment(id, { parcel: { weightGrams: grams, lengthCm: Number(f.l), widthCm: Number(f.w), heightCm: Number(f.h) },
            invoice: { number: f.nfNumber, series: f.nfSeries, accessKey: f.nfKey, issuedAt, issuerTaxId: f.nfTax.replace(/\D/g, "") } });
          onDone(); return r;
        }, "Etiqueta gerada."); }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "var(--space-3)" }}>
            <Field label="Peso (kg)"><Input value={f.weight} onChange={set("weight")} inputMode="decimal" /></Field>
            <Field label="Comprimento (cm)"><Input value={f.l} onChange={set("l")} inputMode="numeric" /></Field>
            <Field label="Largura (cm)"><Input value={f.w} onChange={set("w")} inputMode="numeric" /></Field>
            <Field label="Altura (cm)"><Input value={f.h} onChange={set("h")} inputMode="numeric" /></Field>
            <Field label="NF-e número"><Input value={f.nfNumber} onChange={set("nfNumber")} /></Field>
            <Field label="Série"><Input value={f.nfSeries} onChange={set("nfSeries")} /></Field>
            <Field label="Chave (44 dígitos)"><Input value={f.nfKey} onChange={set("nfKey")} inputMode="numeric" aria-invalid={f.nfKey !== "" && !/^\d{44}$/.test(f.nfKey)} /></Field>
            <Field label="Emissão"><Input type="datetime-local" value={f.nfDate} onChange={set("nfDate")} /></Field>
            <Field label="CNPJ do emitente"><Input value={f.nfTax} onChange={set("nfTax")} inputMode="numeric" /></Field>
          </div>
          <Button type="submit" disabled={act.busy || !valid}>Gerar etiqueta na transportadora</Button>
        </form>
        <form onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api.setTracking(id, code); onDone(); }, "Rastreio salvo."); }} style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)", alignItems: "end" }}>
          <Field label="…ou informe o código de rastreio manualmente"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Button type="submit" kind="secondary" disabled={act.busy || code.length < 4}>Salvar código</Button>
        </form>
      </div>}
    </div>
  );
}
export type { OrderDetail };
