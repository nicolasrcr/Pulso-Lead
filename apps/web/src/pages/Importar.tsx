import { useState } from "react";
import { ActionMsg, Button, Card, Notice, Table, useAction } from "../ui";
import type { ImportStats } from "../api";
import type { PageProps } from "./types";

export function Importar({ api }: PageProps) {
  const act = useAction();
  const [csv, setCsv] = useState("");
  const [stats, setStats] = useState<ImportStats | null>(null);
  return (
    <Card title="Importar pedidos (CSV)">
      <Notice>Colunas: <code>id_externo, plano_id, nome, cpf, telefone, email, uf, total, afiliado_id, pago</code>. Reimportar o mesmo <code>id_externo</code> não duplica.</Notice>
      <input type="file" accept=".csv,text/csv" aria-label="Arquivo CSV" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setStats(null); } }} />
      <p>{csv ? `${csv.split(/\r?\n/).filter(Boolean).length - 1} linha(s) carregada(s).` : "Nenhum arquivo selecionado."}</p>
      <Button disabled={act.busy || !csv} onClick={() => act.run(async () => setStats((await api.importCsv(csv)).stats), "Importação concluída.")}>Importar</Button>
      <ActionMsg msg={act.msg} />
      {stats && <>
        <p>Total {stats.total} · criados {stats.created} · duplicados {stats.duplicates} · falhas {stats.failed}</p>
        {stats.errors.length > 0 && <Table rows={stats.errors} rowKey={(e) => String(e.row)} cols={[{ head: "Linha", align: "right", cell: (e) => e.row }, { head: "Erro", cell: (e) => e.error }]} />}
      </>}
    </Card>
  );
}
