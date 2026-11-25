import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { errorText } from "./errors";

export const box: CSSProperties = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-4)" };
const btn: CSSProperties = { background: "var(--color-brand)", color: "var(--color-onBrand)", border: 0, borderRadius: "var(--radius-md)", padding: "var(--space-2) var(--space-4)", cursor: "pointer" };
const btn2: CSSProperties = { ...btn, background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" };
const btnDanger: CSSProperties = { ...btn, background: "var(--color-danger)" };

export function Button({ kind = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "danger" }) {
  return <button {...p} style={{ ...(kind === "secondary" ? btn2 : kind === "danger" ? btnDanger : btn), opacity: p.disabled ? 0.6 : 1, ...p.style }} />;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "block", marginBottom: "var(--space-3)" }}><span style={{ display: "block", color: "var(--color-muted)", fontSize: 13 }}>{label}</span>{children}</label>;
}
export const inputStyle: CSSProperties = { display: "block", width: "100%", padding: "var(--space-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", font: "inherit", boxSizing: "border-box" };
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} style={{ ...inputStyle, ...p.style }} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} style={{ ...inputStyle, ...p.style }} />;

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section style={{ ...box, marginBottom: "var(--space-4)" }}>
      {(title || actions) && <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
        {title && <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>}<span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>{actions}</span></div>}
      {children}
    </section>
  );
}
export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  const color = kind === "error" ? "var(--color-danger)" : kind === "ok" ? "var(--color-success)" : "var(--color-muted)";
  return <p role={kind === "error" ? "alert" : "status"} style={{ color, margin: "var(--space-2) 0" }}>{children}</p>;
}
export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "bad" }) {
  const c = { muted: "var(--color-muted)", ok: "var(--color-success)", warn: "var(--color-warning)", bad: "var(--color-danger)" }[tone];
  return <span style={{ border: `1px solid ${c}`, color: c, borderRadius: 999, padding: "0 8px", fontSize: 12, whiteSpace: "nowrap" }}>{children}</span>;
}
export function Table<T>({ rows, cols, empty = "Nada por aqui ainda.", rowKey }: { rows: T[]; cols: { head: string; cell: (r: T) => ReactNode; align?: "right" }[]; empty?: string; rowKey: (r: T) => string }) {
  if (!rows.length) return <Notice>{empty}</Notice>;
  const th: CSSProperties = { textAlign: "left", padding: "var(--space-2)", borderBottom: "1px solid var(--color-border)", color: "var(--color-muted)", fontWeight: 500, fontSize: 13 };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{cols.map((c) => <th key={c.head} style={{ ...th, textAlign: c.align ?? "left" }}>{c.head}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={rowKey(r)}>{cols.map((c) => <td key={c.head} style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--color-border)", textAlign: c.align ?? "left" }}>{c.cell(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Carrega dados e expõe reload. Descarta respostas de chamadas antigas (troca de projeto/rápido clicar). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    fn().then((d) => { if (my === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (my === seq.current) setError(errorText(e)); })
      .finally(() => { if (my === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

/** Executa uma ação com estado de "ocupado" e mensagem de erro/sucesso padronizados. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const run = async <R,>(fn: () => Promise<R>, okText?: string): Promise<R | undefined> => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); if (okText) setMsg({ kind: "ok", text: okText }); return r; }
    catch (e) { setMsg({ kind: "error", text: errorText(e) }); return undefined; }
    finally { setBusy(false); }
  };
  return { busy, msg, run, clear: () => setMsg(null) };
}
export const ActionMsg = ({ msg }: { msg: { kind: "ok" | "error"; text: string } | null }) => (msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null);

/** Segredo exibido uma única vez (conector, webhook). */
export function SecretOnce({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <div role="alert" style={{ ...box, borderColor: "var(--color-warning)", marginBottom: "var(--space-3)" }}>
      <strong>{label}</strong> — copie agora, não será mostrado de novo.
      <pre style={{ userSelect: "all", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{value}</pre>
      <Button kind="secondary" onClick={onClose}>Já copiei</Button>
    </div>
  );
}

export function saveTextFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");
export const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
