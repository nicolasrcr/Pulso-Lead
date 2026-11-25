import { describe, it, expect } from "vitest";
import { visiblePages, type PageKey } from "../src/nav";

const keys = (caps: string[], platformAdmin = false, hasProject = true) => visiblePages({ capabilities: caps, platformAdmin, hasProject }).map((p) => p.key);

describe("menu por capability", () => {
  it("operador de atendimento vê só painel, pedidos e importação", () => {
    expect(keys(["orders.create", "notes.create", "dashboard.own"])).toEqual<PageKey[]>(["painel", "pedidos", "importar"]);
  });
  it("administrador vê tudo do projeto, menos o back-office", () => {
    const all = ["orders.read_all", "orders.edit", "orders.create", "products.manage", "users.manage", "reports.read", "dashboard.full"];
    const k = keys(all);
    for (const p of ["painel", "pedidos", "catalogo", "estoque", "afiliados", "integracoes", "transportadora", "webhooks", "equipe", "importar", "exportar"] as PageKey[]) expect(k).toContain(p);
    expect(k).not.toContain("backoffice");
  });
  it("admin da plataforma vê o back-office mesmo sem projeto selecionado; sem projeto nada mais aparece", () => {
    expect(keys([], true, false)).toEqual<PageKey[]>(["backoffice"]);
    expect(keys(["users.manage"], false, false)).toEqual([]);
  });
  it("sem nenhuma capability só há o painel", () => { expect(keys([])).toEqual<PageKey[]>(["painel"]); });
});
