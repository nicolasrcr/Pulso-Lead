import { useState } from "react";
import { ActionMsg, Badge, Button, Card, Field, fmtDate, humanize, Input, Notice, Select, SecretOnce, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

const PROVIDERS: string[] = ["payt", "braip", "b4you", "getenvios"];
const FIRST = "payt";

export function Vendas({ api, projectId }: PageProps) {
  const con = useLoad(() => api.connectors(), [api, projectId]);
  const cat = useLoad(() => api.products().catch(() => ({ products: [], plans: [] })), [api, projectId]);
  const aff = useLoad(() => api.affiliates().catch(() => ({ affiliates: [] })), [api, projectId]);
  const [status, setStatus] = useState("");
  const ev = useLoad(() => api.salesEvents(status || undefined), [api, projectId, status]);
  const a1 = useAction(), a2 = useAction(), a3 = useAction(), a4 = useAction();
  const [provider, setProvider] = useState(FIRST);
  const [secret, setSecret] = useState<{ path: string; secret: string } | null>(null);
  const [pl, setPl] = useState({ provider: FIRST, externalProductId: "", planId: "" });
  const [em, setEm] = useState({ provider: FIRST, email: "", affiliateId: "" });
  return (
    <div>
      <Notice>Mapeadores PayT/Braip/B4You/Get Envios são provisórios até validarmos payloads reais de cada plataforma.</Notice>
      <Card title="Conectores de venda">
        <Table rows={con.data?.connectors ?? []} rowKey={(c) => c.id} empty="Nenhum conector." cols={[
          { head: "Plataforma", cell: (c) => c.provider }, { head: "Status", cell: (c) => <Badge tone={c.active ? "ok" : "bad"}>{c.active ? "Ativo" : "Inativo"}</Badge> }, { head: "Criado", cell: (c) => fmtDate(c.createdAt) },
        ]} />
        <form onSubmit={(e) => { e.preventDefault(); a1.run(async () => { const r = await api.createConnector(provider); setSecret({ path: r.path, secret: r.secret }); con.reload(); }); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", marginTop: "var(--space-3)" }}>
          <Field label="Plataforma"><Select value={provider} onChange={(e) => setProvider(e.target.value)}>{PROVIDERS.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Button type="submit" disabled={a1.busy}>Criar conector</Button>
        </form>
        <ActionMsg msg={a1.msg} />
        {secret && <><p>URL do webhook (cole na plataforma): <code style={{ wordBreak: "break-all" }}>{`${location.origin}${secret.path}`}</code></p>
          <SecretOnce label="Segredo do conector" value={secret.secret} onClose={() => setSecret(null)} /></>}
      </Card>
      <Card title="Vincular produto externo a um plano">
        <form onSubmit={(e) => { e.preventDefault(); a2.run(async () => { await api.createProductLink(pl.provider, pl.externalProductId, pl.planId); setPl({ ...pl, externalProductId: "" }); }, "Vínculo criado."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
          <Field label="Plataforma"><Select value={pl.provider} onChange={(e) => setPl({ ...pl, provider: e.target.value })}>{PROVIDERS.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="ID do produto na plataforma"><Input required value={pl.externalProductId} onChange={(e) => setPl({ ...pl, externalProductId: e.target.value })} /></Field>
          <Field label="Plano"><Select required value={pl.planId} onChange={(e) => setPl({ ...pl, planId: e.target.value })}><option value="">Selecione…</option>{cat.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Button type="submit" disabled={a2.busy || !pl.planId || !pl.externalProductId}>Vincular</Button>
        </form><ActionMsg msg={a2.msg} />
      </Card>
      <Card title="Vincular e-mail de afiliado">
        <form onSubmit={(e) => { e.preventDefault(); a3.run(async () => { await api.createAffiliateEmailLink(em.provider, em.email, em.affiliateId); setEm({ ...em, email: "" }); }, "Vínculo criado."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
          <Field label="Plataforma"><Select value={em.provider} onChange={(e) => setEm({ ...em, provider: e.target.value })}>{PROVIDERS.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="E-mail na plataforma"><Input type="email" required value={em.email} onChange={(e) => setEm({ ...em, email: e.target.value })} /></Field>
          <Field label="Afiliado"><Select required value={em.affiliateId} onChange={(e) => setEm({ ...em, affiliateId: e.target.value })}><option value="">Selecione…</option>{aff.data?.affiliates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Button type="submit" disabled={a3.busy || !em.affiliateId || !em.email}>Vincular</Button>
        </form><ActionMsg msg={a3.msg} />
      </Card>
      <Card title="Eventos recebidos" actions={<>
        <Select aria-label="Filtro" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="received">Recebidos</option><option value="processed">Processados</option><option value="failed">Falhos</option></Select>
        <Button kind="secondary" disabled={a4.busy} onClick={() => a4.run(async () => { const r = await api.reprocessSales(); ev.reload(); return r; }, "Reprocessamento concluído.")}>Reprocessar pendentes</Button></>}>
        <ActionMsg msg={a4.msg} />
        {ev.error && <Notice kind="error">{ev.error}</Notice>}
        <Table rows={ev.data?.events ?? []} rowKey={(e) => e.id} empty="Nenhum evento." cols={[
          { head: "Recebido", cell: (e) => fmtDate(e.receivedAt) }, { head: "Plataforma", cell: (e) => e.provider }, { head: "Evento", cell: (e) => e.eventId },
          { head: "Status", cell: (e) => <Badge tone={e.status === "processed" ? "ok" : e.status === "failed" ? "bad" : "warn"}>{humanize(e.status)}</Badge> }, { head: "Tentativas", align: "right", cell: (e) => e.attempts },
        ]} />
      </Card>
    </div>
  );
}
