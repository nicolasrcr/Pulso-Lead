import { useState } from "react";
import { ActionMsg, Badge, Button, Card, Field, fmtDate, humanize, Input, Notice, SecretOnce, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

const EVENTS = ["ORDER_CREATE", "CHARGE_UPDATED", "SHIPPING_REGISTER", "SHIPPING_UPDATE"];

export function Webhooks({ api, projectId }: PageProps) {
  const wh = useLoad(() => api.webhooks(), [api, projectId]);
  const dl = useLoad(() => api.deliveries(), [api, projectId]);
  const act = useAction(), row = useAction();
  const [f, setF] = useState({ name: "", url: "", events: [...EVENTS] });
  const [secret, setSecret] = useState<string | null>(null);
  const toggle = (e: string) => setF({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] });
  return (
    <div>
      {wh.error && <Notice kind="error">{wh.error}</Notice>}
      <ActionMsg msg={row.msg} />
      {secret && <SecretOnce label="Segredo do webhook (assinatura HMAC)" value={secret} onClose={() => setSecret(null)} />}
      <Card title="Webhooks de saída">
        <Table rows={wh.data?.webhooks ?? []} rowKey={(w) => w.id} empty="Nenhum webhook." cols={[
          { head: "Nome", cell: (w) => w.name }, { head: "URL", cell: (w) => <code>{w.url}</code> }, { head: "Eventos", cell: (w) => w.events.join(", ") },
          { head: "Status", cell: (w) => <Badge tone={w.active ? "ok" : "bad"}>{w.active ? "Ativo" : "Pausado"}</Badge> },
          { head: "", cell: (w) => <span style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button kind="secondary" disabled={row.busy} onClick={() => row.run(async () => { await api.updateWebhook(w.id, { active: !w.active }); wh.reload(); })}>{w.active ? "Pausar" : "Ativar"}</Button>
            <Button kind="secondary" disabled={row.busy} onClick={() => { if (confirm("Rotacionar o segredo? O atual deixa de valer imediatamente.")) row.run(async () => setSecret((await api.rotateWebhookSecret(w.id)).secret)); }}>Rotacionar segredo</Button></span> },
        ]} />
      </Card>
      <Card title="Novo webhook">
        <form onSubmit={(e) => { e.preventDefault(); act.run(async () => { const r = await api.createWebhook(f.name, f.url, f.events); setSecret(r.secret); setF({ name: "", url: "", events: [...EVENTS] }); wh.reload(); }); }}>
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="URL (https)"><Input required type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
          </div>
          <div>{EVENTS.map((e) => <label key={e} style={{ marginRight: "var(--space-3)" }}><input type="checkbox" checked={f.events.includes(e)} onChange={() => toggle(e)} /> {e}</label>)}</div>
          <Button type="submit" disabled={act.busy || !f.name || !f.url || f.events.length === 0}>Criar webhook</Button>
        </form><ActionMsg msg={act.msg} />
      </Card>
      <Card title="Entregas" actions={<Button kind="secondary" onClick={dl.reload}>Atualizar</Button>}>
        {dl.error && <Notice kind="error">{dl.error}</Notice>}
        <Table rows={dl.data?.deliveries ?? []} rowKey={(d) => d.id} empty="Nenhuma entrega." cols={[
          { head: "Quando", cell: (d) => fmtDate(d.createdAt) }, { head: "Evento", cell: (d) => d.event },
          { head: "Status", cell: (d) => <Badge tone={d.status === "delivered" ? "ok" : d.status === "failed" ? "bad" : "warn"}>{humanize(d.status)}</Badge> },
          { head: "HTTP", align: "right", cell: (d) => d.lastStatusCode ?? "—" }, { head: "Tent.", align: "right", cell: (d) => d.attempts }, { head: "Erro", cell: (d) => d.lastError ?? "" },
          { head: "", cell: (d) => (d.status !== "delivered" ? <Button kind="secondary" disabled={row.busy} onClick={() => row.run(async () => { await api.resendDelivery(d.id); dl.reload(); }, "Reenvio agendado.")}>Reenviar</Button> : null) },
        ]} />
      </Card>
    </div>
  );
}
