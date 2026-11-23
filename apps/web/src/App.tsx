import { posPagoV1 } from "@pulso/templates";

// Casca inicial: colunas do kanban vêm do template (dados), não de `if` por atividade.
export function App() {
  return (
    <main style={{ fontFamily: "var(--font-sans)", background: "var(--color-background)", color: "var(--color-text)", minHeight: "100vh", padding: "var(--space-6)" }}>
      <h1>Pulso-Lead</h1>
      <p style={{ color: "var(--color-muted)" }}>Template ativo: {posPagoV1.label} (v{posPagoV1.version})</p>
      <section style={{ display: "flex", gap: "var(--space-3)", overflowX: "auto" }}>
        {posPagoV1.kanban.map((b) => (
          <div key={b.key} style={{ minWidth: 200, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" }}>
            <strong>{b.label}</strong>
          </div>
        ))}
      </section>
    </main>
  );
}
