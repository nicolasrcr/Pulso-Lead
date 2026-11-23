import { describe, it, expect } from "vitest";
import { SHIPPING_STATUSES } from "@pulso/domain";
import { posPagoV1, validateTemplate } from "../src/index";

describe("template pos-pago v1", () => {
  it("é válido segundo o validador de templates", () => {
    expect(validateTemplate(posPagoV1)).toEqual([]);
  });
  it("status de envio do template existem na máquina de estados do domínio", () => {
    const keys = posPagoV1.axes.shipping.statuses.map((s) => s.key);
    for (const k of keys) expect(SHIPPING_STATUSES as readonly string[]).toContain(k);
  });
  it("três eixos independentes: plataforma, envio e pagamento", () => {
    expect(Object.keys(posPagoV1.axes).sort()).toEqual(["payment", "platform", "shipping"]);
  });
  it("todo status tem rótulo pt-BR e categoria canônica", () => {
    for (const axis of Object.values(posPagoV1.axes))
      for (const s of axis.statuses) {
        expect(s.label.length).toBeGreaterThan(0);
        expect(["initial", "in_progress", "success", "failure", "cancelled"]).toContain(s.category);
      }
  });
  it("buckets do kanban só referenciam status existentes", () => {
    const all = new Set(Object.entries(posPagoV1.axes).flatMap(([axis, a]) => a.statuses.map((s) => `${axis}:${s.key}`)));
    for (const b of posPagoV1.kanban)
      for (const ref of b.match) expect(all.has(ref), `${b.key} -> ${ref}`).toBe(true);
  });
  it("validador acusa transição para status inexistente", () => {
    const bad = structuredClone(posPagoV1);
    bad.axes.payment.transitions.push({ from: "pago", to: "nao_existe" });
    expect(validateTemplate(bad).length).toBeGreaterThan(0);
  });
  it("o prazo de inadimplência padrão é 15 dias e configurável", () => {
    expect(posPagoV1.defaults.overdueGraceDays).toBe(15);
  });
});

import { deriveBuckets } from "../src/index";
describe("kanban derivado dos três eixos", () => {
  it("pedido entregue e pago aparece em Entregues e em Pagos", () => {
    const keys = deriveBuckets(posPagoV1, { platform: "cobrado", shipping: "entregue", payment: "pago" });
    expect(keys).toContain("entregues");
    expect(keys).toContain("pagos");
  });
  it("pedido inadimplente aparece em Inadimplências", () => {
    expect(deriveBuckets(posPagoV1, { platform: "inadimplente", shipping: "entregue", payment: "pendente" })).toContain("inadimplencias");
  });
  it("pedido sem correspondência não some: cai em lista vazia, nunca lança", () => {
    expect(deriveBuckets(posPagoV1, { platform: "criado", shipping: "devolvido", payment: "sem_status" })).toEqual([]);
  });
});
