import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createApiClient, type ApiClient, type Me } from "./api";
import { errorText } from "./errors";
import { visiblePages, type PageKey } from "./nav";
import { Button, Field, Input, Notice } from "./ui";
import { Painel } from "./pages/Painel";
import type { PageProps } from "./pages/types";

const store = {
  get: () => sessionStorage.getItem("pulso.token"),
  set: (v: string | null) => (v ? sessionStorage.setItem("pulso.token", v) : sessionStorage.removeItem("pulso.token")),
};

export function App({ client }: { client?: ApiClient } = {}) {
  const [authed, setAuthed] = useState(!!store.get());
  const api = useMemo(() => client ?? createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? "", store, onUnauthorized: () => setAuthed(false) }), [client]);
  return authed ? <Shell api={api} onLogout={() => setAuthed(false)} /> : <Login api={api} onDone={() => setAuthed(true)} />;
}

export function Login({ api, onDone }: { api: ApiClient; onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ email: "", name: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <main style={{ fontFamily: "var(--font-sans)", maxWidth: 360, margin: "10vh auto", padding: "var(--space-6)" }}>
      <h1>Pulso-Lead</h1>
      <form onSubmit={async (e) => {
        e.preventDefault(); setError(null); setBusy(true);
        try { if (mode === "register") await api.register(f.email, f.name, f.password); await api.login(f.email, f.password); onDone(); }
        catch (err) { setError(mode === "login" ? "E-mail ou senha inválidos." : errorText(err)); }
        finally { setBusy(false); }
      }}>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={set("email")} required autoComplete="username" /></Field>
        {mode === "register" && <Field label="Nome"><Input value={f.name} onChange={set("name")} required /></Field>}
        <Field label="Senha"><Input type="password" value={f.password} onChange={set("password")} required minLength={mode === "register" ? 8 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} /></Field>
        {error && <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <Button type="submit" disabled={busy}>{mode === "login" ? "Entrar" : "Criar conta"}</Button>{" "}
        <Button type="button" kind="secondary" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>{mode === "login" ? "Criar conta" : "Já tenho conta"}</Button>
      </form>
    </main>
  );
}

// Páginas carregadas sob demanda: o bundle inicial traz só login, shell e painel.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType<PageProps>>>, name: K) => lazy(async () => ({ default: (await load())[name] }));
const Pedidos = page(() => import("./pages/Pedidos"), "Pedidos");
const Catalogo = page(() => import("./pages/Catalogo"), "Catalogo");
const Estoque = page(() => import("./pages/Estoque"), "Estoque");
const Afiliados = page(() => import("./pages/Afiliados"), "Afiliados");
const Vendas = page(() => import("./pages/Vendas"), "Vendas");
const Transportadora = page(() => import("./pages/Transportadora"), "Transportadora");
const Webhooks = page(() => import("./pages/Webhooks"), "Webhooks");
const Equipe = page(() => import("./pages/Equipe"), "Equipe");
const Importar = page(() => import("./pages/Importar"), "Importar");
const Exportar = page(() => import("./pages/Exportar"), "Exportar");
const Backoffice = page(() => import("./pages/Backoffice"), "Backoffice");

const PAGES: Record<PageKey, (p: PageProps) => ReactNode> = {
  painel: (p) => <Painel api={p.api} projectId={p.projectId} caps={p.caps} />, pedidos: Pedidos, catalogo: Catalogo, estoque: Estoque, afiliados: Afiliados,
  integracoes: Vendas, transportadora: Transportadora, webhooks: Webhooks, equipe: Equipe, importar: Importar, exportar: Exportar, backoffice: Backoffice,
};

export function Shell({ api, onLogout }: { api: ApiClient; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [page, setPage] = useState<PageKey>((location.hash.slice(1) as PageKey) || "painel");
  useEffect(() => {
    api.me().then((m) => { setMe(m); const first = m.projects[0]?.id; if (first) { setProjectId(first); api.selectProject(first); } }).catch((e) => setError(errorText(e)));
  }, [api]);
  const caps = (projectId && me?.capabilities[projectId]) || [];
  const pages = me ? visiblePages({ capabilities: caps, platformAdmin: me.user.platformAdmin, hasProject: !!projectId }) : [];
  const current = pages.some((p) => p.key === page) ? page : pages[0]?.key;
  const go = (k: PageKey) => { setPage(k); location.hash = k; };
  if (error) return <main style={{ padding: "var(--space-6)" }}><Notice kind="error">{error}</Notice><Button onClick={onLogout}>Sair</Button></main>;
  if (!me) return <main style={{ padding: "var(--space-6)" }}>Carregando…</main>;
  const Page = current ? PAGES[current] : null;
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "var(--font-sans)" }}>
      <nav aria-label="Principal" style={{ width: 220, padding: "var(--space-4)", borderRight: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        <h2 style={{ marginTop: 0 }}>Pulso-Lead</h2>
        {me.projects.length > 0 && <select aria-label="Projeto" value={projectId} onChange={(e) => { setProjectId(e.target.value); api.selectProject(e.target.value); }} style={{ width: "100%", marginBottom: "var(--space-3)" }}>
          {me.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {pages.map((p) => <button key={p.key} onClick={() => go(p.key)} aria-current={p.key === current ? "page" : undefined}
          style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderRadius: "var(--radius-sm)", padding: "var(--space-2)", cursor: "pointer", font: "inherit",
            background: p.key === current ? "var(--color-brand)" : "transparent", color: p.key === current ? "var(--color-onBrand)" : "inherit" }}>{p.label}</button>)}
        <p style={{ fontSize: 13 }}>{me.user.name}</p>
        <Button kind="secondary" onClick={async () => { await api.logout().catch(() => undefined); onLogout(); }}>Sair</Button>
      </nav>
      <main style={{ flex: 1, padding: "var(--space-5)", minWidth: 0 }}>
        {!projectId && !me.user.platformAdmin && <Notice>Você ainda não tem acesso a nenhum projeto. Aguarde a aprovação do administrador.</Notice>}
        {Page && (projectId || current === "backoffice") ? <Suspense fallback={<p role="status">Carregando…</p>}><Page key={`${current}:${projectId}`} api={api} me={me} projectId={projectId} caps={caps} /></Suspense> : null}
      </main>
    </div>
  );
}
