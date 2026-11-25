import { ActionMsg, Button, Card, Notice, saveTextFile, useAction } from "../ui";
import type { PageProps } from "./types";

const FILES = [
  { path: "/v1/export/orders.csv", title: "Pedidos", note: "Sem CPF; telefone mascarado." },
  { path: "/v1/export/ledger.csv", title: "Comissões (ledger)", note: "Lançamentos de crédito e estorno." },
  { path: "/v1/dashboard/export.csv", title: "Painel", note: "Resumo por projeto." },
];

export function Exportar({ api }: PageProps) {
  const act = useAction();
  return (
    <Card title="Exportar">
      <Notice>Os arquivos respeitam o seu acesso e não incluem CPF.</Notice>
      <ActionMsg msg={act.msg} />
      {FILES.map((f) => <p key={f.path}><Button disabled={act.busy} onClick={() => act.run(async () => { const r = await api.download(f.path); saveTextFile(r.filename, r.text); }, "Download iniciado.")}>Baixar {f.title}</Button> {f.note}</p>)}
    </Card>
  );
}
