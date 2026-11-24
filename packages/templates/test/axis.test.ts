import { describe, it, expect } from "vitest";
import { posPagoV1, canTransitionAxis } from "../src/index";

describe("transições dos eixos de plataforma e pagamento (dados do template)", () => {
  it("pagamento: pendente → pago permitido; pago → pendente não", () => {
    expect(canTransitionAxis(posPagoV1, "payment", "pendente", "pago")).toBe(true);
    expect(canTransitionAxis(posPagoV1, "payment", "pago", "pendente")).toBe(false);
  });
  it("plataforma: cobrado → inadimplente → frustrado; frustrado é terminal", () => {
    expect(canTransitionAxis(posPagoV1, "platform", "cobrado", "inadimplente")).toBe(true);
    expect(canTransitionAxis(posPagoV1, "platform", "inadimplente", "frustrado")).toBe(true);
    expect(canTransitionAxis(posPagoV1, "platform", "frustrado", "concluido")).toBe(false);
  });
  it("inadimplente que paga volta a concluído", () => {
    expect(canTransitionAxis(posPagoV1, "platform", "inadimplente", "concluido")).toBe(true);
  });
  it("transição inexistente ou status desconhecido é falso, nunca lança", () => {
    expect(canTransitionAxis(posPagoV1, "payment", "pago", "nao_existe")).toBe(false);
    expect(canTransitionAxis(posPagoV1, "platform", "x", "y")).toBe(false);
  });
  it("o eixo de envio é do domínio, não do template", () => {
    expect(() => canTransitionAxis(posPagoV1, "shipping", "enviado", "em_transito")).toThrow();
  });
});
