import { describe, it, expect } from "vitest";
import { applyShippingEvent, canTransition, reopenTerminal, isTerminal } from "../src/shipping-state";

const t = (iso: string) => new Date(iso);

describe("máquina de estados de envio", () => {
  it("caminho feliz até entregue", () => {
    let s = { status: "sem_status" as const, lastEventAt: null as Date | null };
    const path = ["preparando_logistica", "preparando", "aguardando_coleta", "coletado", "enviado", "em_transito", "rota_entrega", "entregue"] as const;
    let day = 1;
    let cur: any = s;
    for (const status of path) {
      const r = applyShippingEvent(cur, { status, occurredAt: t(`2026-11-${String(day++).padStart(2, "0")}T10:00:00Z`) });
      expect(r.applied).toBe(true);
      cur = r.state;
    }
    expect(cur.status).toBe("entregue");
    expect(isTerminal(cur.status)).toBe(true);
  });

  it("evento com occurredAt antigo não regride o status", () => {
    const cur = { status: "rota_entrega" as const, lastEventAt: t("2026-11-10T12:00:00Z") };
    const r = applyShippingEvent(cur, { status: "em_transito", occurredAt: t("2026-11-09T12:00:00Z") });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("stale");
    expect(r.state.status).toBe("rota_entrega");
  });

  it("transição inválida é recusada sem alterar o estado", () => {
    const cur = { status: "preparando" as const, lastEventAt: t("2026-11-01T00:00:00Z") };
    const r = applyShippingEvent(cur, { status: "entregue", occurredAt: t("2026-11-02T00:00:00Z") });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("invalid_transition");
  });

  it("não entregue permite nova tentativa, retorno ou retirada", () => {
    expect(canTransition("nao_entregue", "rota_entrega")).toBe(true);
    expect(canTransition("nao_entregue", "retornando")).toBe(true);
    expect(canTransition("nao_entregue", "pronto_retirada")).toBe(true);
    expect(canTransition("retornando", "devolvido")).toBe(true);
    expect(canTransition("retornando", "retornado_reverso")).toBe(true);
  });

  it("qualquer estado não terminal pode ir para excepcional; terminal não", () => {
    expect(canTransition("em_transito", "avariado")).toBe(true);
    expect(canTransition("em_transito", "perdido")).toBe(true);
    expect(canTransition("entregue", "avariado")).toBe(false);
    expect(canTransition("devolvido", "em_transito")).toBe(false);
  });

  it("reabrir terminal exige ator e motivo e gera registro de auditoria", () => {
    expect(() => reopenTerminal({ status: "perdido", lastEventAt: null }, "em_transito", { actorId: "", reason: "" })).toThrow();
    const r = reopenTerminal(
      { status: "perdido", lastEventAt: t("2026-11-01T00:00:00Z") },
      "em_transito",
      { actorId: "u1", reason: "transportadora localizou o pacote" },
    );
    expect(r.state.status).toBe("em_transito");
    expect(r.audit).toMatchObject({ from: "perdido", to: "em_transito", actorId: "u1" });
  });
});
