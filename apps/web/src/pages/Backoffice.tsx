import { useState } from "react";
import { formatBrl } from "../format";
import { ActionMsg, Badge, Button, Card, Field, fmtDate, humanize, Input, Notice, Select, Table, useAction, useLoad } from "../ui";
import { parseMoneyToCents } from "../rules";
import type { PageProps } from "./types";

const STATUSES = ["garantia", "ativo", "em_atraso", "suspenso", "encerrado"];

export function Backoffice({ api }: PageProps) {
  const ov = useLoad(() => api.backofficeOverview(), [api]);
  const [org, setOrg] = useState<string | null>(null);
  const audit = useLoad(() => api.backofficeAudit(org ?? undefined), [api, org]);
  const act = useAction();
  const [sub, setSub] = useState({ planKey: "", fee: "", cap: "" });
  const [st, setSt] = useState({ to: "ativo", reason: "" });
  const [confirm, setConfirm] = useState("");
  const cur = ov.data?.organizations.find((o) => o.organizationId === org);
  const fee = parseMoneyToCents(sub.fee), cap = Number(sub.cap);
  const refresh = () => { ov.reload(); audit.reload(); };
  return (
    <div>
      {ov.error && <Notice kind="error">{ov.error}</Notice>}
      <Card title="Organizações">
        <Table rows={ov.data?.organizations ?? []} rowKey={(o) => o.organizationId} empty="Nenhuma organização." cols={[
          { head: "Organização", cell: (o) => <button onClick={() => setOrg(o.organizationId)} style={{ all: "unset", cursor: "pointer", color: "var(--color-brand)" }}>{o.name}</button> },
          { head: "Status", cell: (o) => <Badge tone={o.status === "suspenso" || o.status === "em_atraso" ? "bad" : o.status === "ativo" ? "ok" : "warn"}>{humanize(o.status)}</Badge> },
          { head: "Plano", cell: (o) => o.plan ?? "—" }, { head: "Mensalidade", align: "right", cell: (o) => (o.monthlyFeeCents === null ? "—" : formatBrl(o.monthlyFeeCents)) },
          { head: "Uso no mês", align: "right", cell: (o) => `${o.usedThisMonth}/${o.orderCap}` }, { head: "Projetos", align: "right", cell: (o) => o.projects }, { head: "Go-live", cell: (o) => fmtDate(o.goLiveAt) },
        ]} />
      </Card>
      {cur && <Card title={`Gerir — ${cur.name}`} actions={<Button kind="secondary" onClick={() => setOrg(null)}>Fechar</Button>}>
        <ActionMsg msg={act.msg} />
        <h3>Assinatura</h3>
        <form onSubmit={(e) => { e.preventDefault(); if (fee === null) return; act.run(async () => { await api.createSubscription(cur.organizationId, { planKey: sub.planKey, monthlyFeeCents: fee, orderCap: cap }); refresh(); }, "Assinatura criada."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
          <Field label="Plano"><Input required value={sub.planKey} onChange={(e) => setSub({ ...sub, planKey: e.target.value })} /></Field>
          <Field label="Mensalidade (R$)"><Input value={sub.fee} inputMode="decimal" onChange={(e) => setSub({ ...sub, fee: e.target.value })} /></Field>
          <Field label="Teto de pedidos/mês"><Input value={sub.cap} inputMode="numeric" onChange={(e) => setSub({ ...sub, cap: e.target.value })} /></Field>
          <Button type="submit" disabled={act.busy || !sub.planKey || fee === null || !Number.isInteger(cap) || cap <= 0}>Criar assinatura</Button>
        </form>
        <h3>Status</h3>
        <form onSubmit={(e) => { e.preventDefault(); if (st.to === "encerrado" && !confirm_("Encerrar a organização? Os dados passam a ser elegíveis para descarte após 30 dias.")) return; act.run(async () => { await api.setBackofficeStatus(cur.organizationId, st.to, st.reason || undefined); refresh(); }, "Status atualizado."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
          <Field label="Novo status"><Select value={st.to} onChange={(e) => setSt({ ...st, to: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          <Field label="Motivo"><Input value={st.reason} maxLength={500} onChange={(e) => setSt({ ...st, reason: e.target.value })} /></Field>
          <Button type="submit" disabled={act.busy}>Aplicar</Button>
        </form>
        {st.to === "suspenso" && <Notice kind="error">Suspender bloqueia escritas de todos os projetos da organização (HTTP 423).</Notice>}
        {cur.status === "encerrado" && <>
          <h3>Descarte de dados pessoais</h3>
          <Notice kind="error">Irreversível. Digite o id da organização para confirmar: <code>{cur.organizationId}</code></Notice>
          <Input aria-label="Confirmação" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button kind="danger" disabled={act.busy || confirm !== cur.organizationId} onClick={() => act.run(async () => { const r = await api.discardPii(cur.organizationId, confirm); setConfirm(""); refresh(); return r; }, "Dados pessoais descartados.")}>Descartar PII</Button>
        </>}
      </Card>}
      <Card title={org ? "Auditoria da organização" : "Auditoria da plataforma"}>
        {audit.error && <Notice kind="error">{audit.error}</Notice>}
        <Table rows={audit.data?.entries ?? []} rowKey={(a) => String(a.id)} empty="Sem registros." cols={[
          { head: "Quando", cell: (a) => fmtDate(a.at) }, { head: "Ação", cell: (a) => a.action }, { head: "Detalhes", cell: (a) => <code>{JSON.stringify(a.meta)}</code> },
        ]} />
      </Card>
    </div>
  );
}
const confirm_ = (m: string) => window.confirm(m);
