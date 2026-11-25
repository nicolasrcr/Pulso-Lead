import { useState } from "react";
import { ActionMsg, Badge, Button, Card, Field, Input, Notice, Select, Table, useAction, useLoad } from "../ui";
import type { PageProps } from "./types";

const empty = { customerCode: "", password: "", apiAccount: "", privateKey: "", env: "homolog", isDefault: true,
  name: "", company: "", postCode: "", taxNumber: "", phone: "", prov: "", city: "", area: "", street: "", streetNumber: "" };

export function Transportadora({ api, projectId }: PageProps) {
  const list = useLoad(() => api.carriers(), [api, projectId]);
  const act = useAction();
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = Object.entries(f).every(([k, v]) => k === "isDefault" || String(v).trim() !== "") && /^\d{8}$/.test(f.postCode.replace(/\D/g, ""));
  const text = (k: keyof typeof empty, label: string, extra?: object) => <Field label={label}><Input value={String(f[k])} onChange={set(k)} {...extra} /></Field>;
  return (
    <div>
      {list.error && <Notice kind="error">{list.error}</Notice>}
      <Card title="Transportadoras">
        <Table rows={list.data?.carriers ?? []} rowKey={(c) => c.id} empty="Nenhuma conta configurada." cols={[
          { head: "Transportadora", cell: (c) => c.carrierKey.toUpperCase() }, { head: "Padrão", cell: (c) => (c.isDefault ? <Badge tone="ok">Padrão</Badge> : "—") }, { head: "Status", cell: (c) => <Badge tone={c.enabled ? "ok" : "bad"}>{c.enabled ? "Ativa" : "Inativa"}</Badge> },
        ]} />
      </Card>
      <Card title="Nova conta J&T">
        <Notice>As credenciais são seladas no servidor e nunca voltam para a tela. Teste em homologação antes de produção.</Notice>
        <form onSubmit={(e) => { e.preventDefault(); act.run(async () => {
          await api.createCarrier({ carrierKey: "jt", isDefault: f.isDefault, credentials: { customerCode: f.customerCode, password: f.password, apiAccount: f.apiAccount, privateKey: f.privateKey, env: f.env,
            sender: { name: f.name, company: f.company, postCode: f.postCode.replace(/\D/g, ""), taxNumber: f.taxNumber.replace(/\D/g, ""), phone: f.phone, prov: f.prov.toUpperCase(), city: f.city, area: f.area, street: f.street, streetNumber: f.streetNumber } } });
          setF(empty); list.reload();
        }, "Conta salva."); }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "var(--space-3)" }}>
            {text("customerCode", "Customer code")}{text("password", "Senha", { type: "password", autoComplete: "off" })}{text("apiAccount", "API account")}{text("privateKey", "Private key", { type: "password", autoComplete: "off" })}
            <Field label="Ambiente"><Select value={f.env} onChange={set("env")}><option value="homolog">Homologação</option><option value="production">Produção</option></Select></Field>
            {text("name", "Remetente — nome")}{text("company", "Empresa")}{text("taxNumber", "CNPJ")}{text("phone", "Telefone")}{text("postCode", "CEP")}{text("prov", "UF", { maxLength: 2 })}{text("city", "Cidade")}{text("area", "Bairro")}{text("street", "Rua")}{text("streetNumber", "Número")}
          </div>
          <label><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> Definir como padrão</label>
          <div><Button type="submit" disabled={act.busy || !ok}>Salvar conta</Button></div>
        </form><ActionMsg msg={act.msg} />
      </Card>
    </div>
  );
}
