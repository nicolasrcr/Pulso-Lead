import { useState } from "react";
import { PRESETS } from "@pulso/domain";
import { ActionMsg, Badge, Button, Card, Notice, Select, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

export function Equipe({ api, projectId, caps }: PageProps) {
  const list = useLoad(() => api.members(projectId), [api, projectId]);
  const act = useAction();
  const [preset, setPreset] = useState<Record<string, string>>({});
  const can = caps.includes("users.manage");
  const presets = Object.keys(PRESETS);
  return (
    <Card title="Equipe">
      {list.error && <Notice kind="error">{list.error}</Notice>}
      <ActionMsg msg={act.msg} />
      <Table rows={list.data?.members ?? []} rowKey={(m) => m.id} empty="Sem membros." cols={[
        { head: "Nome", cell: (m) => m.name }, { head: "E-mail", cell: (m) => m.email }, { head: "Papel", cell: (m) => m.role },
        { head: "Status", cell: (m) => <Badge tone={m.approved ? "ok" : "warn"}>{m.approved ? "Aprovado" : "Pendente"}</Badge> },
        { head: "Permissões", cell: (m) => m.capabilities.length },
        { head: "", cell: (m) => (can && !m.approved ? <span style={{ display: "flex", gap: "var(--space-2)" }}>
          <Select aria-label="Perfil" value={preset[m.id] ?? ""} onChange={(e) => setPreset({ ...preset, [m.id]: e.target.value })}><option value="">Perfil…</option>{presets.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
          <Button disabled={act.busy || !preset[m.id]} onClick={() => act.run(async () => { await api.approveMembership(m.id, preset[m.id]!); list.reload(); }, "Aprovado.")}>Aprovar</Button>
          <Button kind="danger" disabled={act.busy} onClick={() => act.run(async () => { await api.rejectMembership(m.id); list.reload(); }, "Rejeitado.")}>Rejeitar</Button></span> : null) },
      ]} />
    </Card>
  );
}
