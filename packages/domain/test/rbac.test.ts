import { describe, it, expect } from "vitest";
import { CAPABILITIES, PRESETS, effectiveCapabilities, can, canGrant } from "../src/rbac";

describe("RBAC — capabilities atômicas e presets", () => {
  it("expõe as 15 capabilities do blueprint", () => {
    expect(CAPABILITIES).toHaveLength(15);
    expect(CAPABILITIES).toContain("orders.create");
    expect(CAPABILITIES).toContain("users.manage");
  });
  it("todo preset usa só capabilities existentes", () => {
    for (const [name, caps] of Object.entries(PRESETS))
      for (const c of caps) expect(CAPABILITIES as readonly string[], `${name}:${c}`).toContain(c);
  });
  it("existem os 9 presets de grupo", () => {
    expect(Object.keys(PRESETS)).toHaveLength(9);
  });
  it("org_admin e platform_admin têm tudo, sem depender de lista", () => {
    expect(effectiveCapabilities({ role: "org_admin", capabilities: [] })).toEqual([...CAPABILITIES]);
    expect(effectiveCapabilities({ role: "operator", capabilities: [], platformAdmin: true })).toEqual([...CAPABILITIES]);
  });
  it("project_admin tem tudo no próprio projeto, menos gerir o que é da organização", () => {
    const caps = effectiveCapabilities({ role: "project_admin", capabilities: [] });
    expect(caps).toContain("users.manage");
    expect(caps).toContain("products.manage");
  });
  it("operador e afiliado só têm o que foi concedido", () => {
    expect(effectiveCapabilities({ role: "operator", capabilities: ["orders.create"] })).toEqual(["orders.create"]);
    expect(effectiveCapabilities({ role: "affiliate", capabilities: [] })).toEqual([]);
  });
  it("capability desconhecida é descartada (nunca amplia acesso)", () => {
    expect(effectiveCapabilities({ role: "operator", capabilities: ["orders.create", "root.everything"] })).toEqual(["orders.create"]);
  });
  it("can() consulta o conjunto efetivo", () => {
    const m = { role: "operator", capabilities: ["orders.read_all"] } as const;
    expect(can(m, "orders.read_all")).toBe(true);
    expect(can(m, "orders.edit")).toBe(false);
  });
  it("Gestor de pedidos vê só o próprio: sem orders.read_all nem dashboard.full", () => {
    expect(PRESETS.gestor_pedidos).not.toContain("orders.read_all");
    expect(PRESETS.gestor_pedidos).not.toContain("dashboard.full");
  });
  it("Cobrança Master vê todos os status e pedidos; Cobrança comum não", () => {
    expect(PRESETS.cobranca_master).toContain("orders.status.all");
    expect(PRESETS.cobranca_master).toContain("orders.read_all");
    expect(PRESETS.cobranca).not.toContain("orders.status.all");
  });
  it("anti-escalada: ninguém concede o que não tem nem papel acima do próprio", () => {
    const pa = { role: "project_admin", capabilities: [] } as const;
    expect(canGrant(pa, { role: "operator", capabilities: ["orders.create"] })).toBe(true);
    expect(canGrant(pa, { role: "project_admin", capabilities: [] })).toBe(false);
    expect(canGrant(pa, { role: "org_admin", capabilities: [] })).toBe(false);
    const op = { role: "operator", capabilities: ["orders.create"] } as const;
    expect(canGrant(op, { role: "affiliate", capabilities: [] })).toBe(false); // operador não concede papéis
    const oa = { role: "org_admin", capabilities: [] } as const;
    expect(canGrant(oa, { role: "project_admin", capabilities: [] })).toBe(true);
  });
});
