import { formatBps, formatBrl } from "../format";
import { volumeMessage } from "../volume";
import { Button, Card, Notice, Table, useLoad, useAction, ActionMsg } from "../ui";
import type { ApiClient } from "../api";

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", minWidth: 140 }}>
    <div style={{ color: "var(--color-muted)", fontSize: 13 }}>{k}</div><div style={{ fontSize: 20, fontWeight: 600 }}>{v}</div>
  </div>
);

export function Painel({ api, projectId, caps }: { api: ApiClient; projectId: string; caps: string[] }) {
  const dash = useLoad(() => api.dashboard(), [api, projectId]);
  const kanban = useLoad(() => api.kanban(), [api, projectId]);
  const volume = useLoad(() => api.volume(), [api, projectId]);
  const act = useAction();
  const vmsg = volume.data ? volumeMessage(volume.data) : null;
  const d = dash.data;
  return (
    <div>
      {vmsg && <Notice kind={vmsg.level === "danger" ? "error" : "info"}>{vmsg.text}</Notice>}
      {dash.error && <Notice kind="error">{dash.error}</Notice>}
      {d?.anyStale && <Notice kind="error">Alguns números estão desatualizados.{" "}
        {caps.includes("dashboard.full") && <Button kind="secondary" disabled={act.busy} onClick={() => act.run(async () => { await api.refreshDashboard(); dash.reload(); })}>Atualizar agora</Button>}</Notice>}
      <ActionMsg msg={act.msg} />
      {d && (
        <>
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
            <Stat k="Pedidos" v={String(d.total.orders)} /><Stat k="Bruto" v={formatBrl(d.total.grossCents)} /><Stat k="Pago" v={formatBrl(d.total.paidCents)} />
            <Stat k="Conversão" v={formatBps(d.total.rates.conversionBps)} /><Stat k="Entrega" v={formatBps(d.total.rates.deliveryBps)} />
            <Stat k="Devolução" v={formatBps(d.total.rates.returnBps)} /><Stat k="Inadimplência" v={formatBps(d.total.rates.overdueBps)} />
          </div>
          <Card title="Por projeto">
            <Table rows={d.byProject} rowKey={(r) => r.projectId} cols={[
              { head: "Projeto", cell: (r) => r.name }, { head: "Pedidos", align: "right", cell: (r) => r.orders },
              { head: "Pago", align: "right", cell: (r) => formatBrl(r.paidCents) }, { head: "Conversão", align: "right", cell: (r) => formatBps(r.rates.conversionBps) },
            ]} />
          </Card>
        </>
      )}
      <Card title="Kanban">
        {kanban.error && <Notice kind="error">{kanban.error}</Notice>}
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {kanban.data?.buckets.map((b) => <Stat key={b.key} k={b.label} v={String(b.count)} />)}
        </div>
      </Card>
    </div>
  );
}
