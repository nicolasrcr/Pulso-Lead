import { describe, it, expect } from "vitest";
import { ApiError } from "../src/api";
import { errorText } from "../src/errors";
describe("mensagens de erro", () => {
  it("prioriza o código, depois o status, e nunca vaza detalhe interno", () => {
    expect(errorText(new ApiError(423, "organization_suspended"))).toMatch(/somente leitura/);
    expect(errorText(new ApiError(409, "insufficient_stock"))).toMatch(/Estoque/);
    expect(errorText(new ApiError(403, "forbidden"))).toMatch(/permissão/);
    expect(errorText(new ApiError(500, "internal_error"))).toBe("Erro no servidor. Tente novamente.");
    expect(errorText(new Error("ECONNREFUSED 10.0.0.1"))).toBe("Falha de conexão.");
  });
});
