import { useEffect, useMemo, useState } from "react";
import { posPagoV1 } from "@pulso/templates";
import { createApiClient, type Me } from "./api";
import { volumeMessage, type VolumeStatus } from "./volume";

const store = {
  get: () => sessionStorage.getItem("pulso.token"),
  set: (v: string | null) => (v ? sessionStorage.setItem("pulso.token", v) : sessionStorage.removeItem("pulso.token")),
};

export function App() {
  const [authed, setAuthed] = useState(!!store.get());
  const api = useMemo(
    () => createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? "", store, onUnauthorized: () => setAuthed(false) }),
    [],
  );
  return authed ? <Shell api={api} onLogout={() => setAuthed(false)} /> : <Login api={api} onDone={() => setAuthed(true)} />;
}

type Api = ReturnType<typeof createApiClient>;

function Login({ api, onDone }: { api: Api; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <main style={{ fontFamily: "var(--font-sans)", maxWidth: 360, margin: "10vh auto", padding: "var(--space-6)" }}>
      <h1>Pulso-Lead</h1>
      <form onSubmit={async (e) => {
        e.preventDefault(); setError(null);
        try { await api.login(email, password); onDone(); } catch { setError("E-mail ou senha inválidos."); }
      }}>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ display: "block", width: "100%" }} /></label>
        <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ display: "block", width: "100%" }} /></label>
        {error && <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <button type="submit" style={{ marginTop: "var(--space-4)", background: "var(--color-brand)", color: "var(--color-onBrand)", border: 0, borderRadius: "var(--radius-md)", padding: "var(--space-2) var(--space-4)" }}>Entrar</button>
      </form>
    </main>
  );
}

function Shell({ api, onLogout }: { api: Api; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [project, setProject] = useState<string>(""); // "" = Todos os projetos
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [volume, setVolume] = useState<VolumeStatus | null>(null);
  useEffect(() => { api.me().then(setMe).catch(() => undefined); }, [api]);
  // Kanban e volume dependem de um projeto selecionado (as capabilities são por projeto).
  useEffect(() => {
    if (!project) { setCounts({}); setVolume(null); return; }
    api.kanban().then((k) => setCounts(Object.fromEntries(k.buckets.map((b) => [b.key, b.count])))).catch(() => setCounts({}));
    api.volume().then(setVolume).catch(() => setVolume(null));
  }, [api, project]);
  const vmsg = volume ? volumeMessage(volume) : null;
  const pending = me?.memberships.filter((m) => m.status === "pending").length ?? 0;
  return (
    <main style={{ fontFamily: "var(--font-sans)", background: "var(--color-background)", color: "var(--color-text)", minHeight: "100vh", padding: "var(--space-6)" }}>
      <header style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Pulso-Lead</h1>
        <select aria-label="Projeto" value={project} onChange={(e) => { setProject(e.target.value); api.selectProject(e.target.value || null); }}>
          {(me?.projects.length ?? 0) > 1 && <option value="">Todos os projetos</option>}
          {me?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span style={{ marginLeft: "auto", color: "var(--color-muted)" }}>{me?.user.name}</span>
        <button onClick={async () => { await api.logout().catch(() => undefined); onLogout(); }}>Sair</button>
      </header>
      {vmsg && <p role="status" style={{ color: vmsg.level === "danger" ? "var(--color-danger)" : "var(--color-warning, var(--color-text))" }}>{vmsg.text}</p>}
      {!project && <p style={{ color: "var(--color-muted)" }}>Selecione um projeto para ver o painel de pedidos.</p>}
      {pending > 0 && <p role="status">{pending} cadastro(s) aguardando aprovação.</p>}
      <section style={{ display: "flex", gap: "var(--space-3)", overflowX: "auto", marginTop: "var(--space-4)" }}>
        {posPagoV1.kanban.map((b) => (
          <div key={b.key} style={{ minWidth: 200, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" }}>
            <strong>{b.label}</strong> <span aria-label={`${counts[b.key] ?? 0} pedidos`}>{counts[b.key] ?? 0}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
