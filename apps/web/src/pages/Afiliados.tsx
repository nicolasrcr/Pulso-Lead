import { useState } from "react";
import { formatBrl } from "../format";
import { ActionMsg, Badge, Button, Card, Field, Input, Notice, Select, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

export function Afiliados({ api, projectId, caps }: PageProps) {
  const aff = useLoad(() => api.affiliates(), [api, projectId]);
  const com = useLoad(() => api.commissions().catch(() => ({ affiliates: [] })), [api, projectId]);
  const cat = useLoad(() => api.products().catch(() => ({ products: [], plans: [] })), [api, projectId]);
  const act = useAction(), link = useAction();
  const [name, setName] = useState("");
  const [lk, setLk] = useState({ affiliateId: "", planId: "" });
  const [url, setUrl] = useState<string | null>(null);
  const bal = new Map((com.data?.affiliates ?? []).map((c) => [c.affiliateId, c]));
  const can = caps.includes("products.manage") || caps.includes("users.manage");
  return (
    <div>
      {aff.error && <Notice kind="error">{aff.error}</Notice>}
      <Card title="Afiliados e comissões">
        <Table rows={aff.data?.affiliates ?? []} rowKey={(a) => a.id} empty="Nenhum afiliado." cols={[
          { head: "Afiliado", cell: (a) => <>{a.name} {!a.active && <Badge tone="bad">Inativo</Badge>}</> },
          { head: "Acumulado", align: "right", cell: (a) => formatBrl(bal.get(a.id)?.accruedCents ?? 0) },
          { head: "Estornado", align: "right", cell: (a) => formatBrl(bal.get(a.id)?.reversedCents ?? 0) },
          { head: "Saldo", align: "right", cell: (a) => <strong>{formatBrl(bal.get(a.id)?.balanceCents ?? 0)}</strong> },
        ]} />
      </Card>
      {can && <Card title="Novo afiliado">
        <form onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api.createAffiliate(name); setName(""); aff.reload(); }, "Afiliado criado."); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end" }}>
          <Field label="Nome"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button type="submit" disabled={act.busy || !name}>Criar</Button>
        </form><ActionMsg msg={act.msg} />
      </Card>}
      <Card title="Link de checkout assinado">
        <form onSubmit={(e) => { e.preventDefault(); link.run(async () => { const r = await api.affiliateLink(lk.affiliateId, lk.planId || undefined); setUrl(`${location.origin}/r/${r.token}`); }); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}>
          <Field label="Afiliado"><Select required value={lk.affiliateId} onChange={(e) => setLk({ ...lk, affiliateId: e.target.value })}><option value="">Selecione…</option>{aff.data?.affiliates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Plano (opcional)"><Select value={lk.planId} onChange={(e) => setLk({ ...lk, planId: e.target.value })}><option value="">Qualquer</option>{cat.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Button type="submit" disabled={link.busy || !lk.affiliateId}>Gerar link</Button>
        </form>
        <ActionMsg msg={link.msg} />
        {url && <p><code style={{ wordBreak: "break-all" }}>{url}</code></p>}
      </Card>
    </div>
  );
}
