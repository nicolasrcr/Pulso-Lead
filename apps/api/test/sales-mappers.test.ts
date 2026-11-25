import { describe, it, expect } from "vitest";
import { mapSale, PROVIDERS } from "../src/sales/mappers";

describe("mapSale", () => {
  it("braip: mapeia campos e converte valor para centavos inteiros", () => {
    const s = mapSale("braip", { trans_key: "T1", prod_key: "P9", client_name: "Ana", client_email: "ana@x.com", client_cel: "(61) 99999-1234",
      trans_value: 197.9, trans_status: "Aguardando pagamento", aff_email: "Af@X.com" });
    expect(s).toMatchObject({ eventId: "T1:pendente", externalOrderId: "T1", externalProductId: "P9", totalCents: 19790, paymentStatus: "pendente", affiliateEmail: "af@x.com" });
    expect(s!.customer).toMatchObject({ name: "Ana", phone: "61999991234", email: "ana@x.com" });
  });
  it("mesmo pedido em outro status gera outro eventId (idempotência por mudança de estado)", () => {
    const a = mapSale("braip", { trans_key: "T1", prod_key: "P", client_name: "A", trans_value: 10, trans_status: "Pagamento Aprovado" });
    expect(a!.paymentStatus).toBe("pago");
    expect(a!.eventId).toBe("T1:pago");
  });
  it("valor em string com vírgula e centavos exatos (sem float)", () => {
    const s = mapSale("payt", { transaction_id: "X", product: { id: "p" }, customer: { name: "B" }, amount: "1.234,56", status: "paid" });
    expect(s!.totalCents).toBe(123456);
    const t = mapSale("payt", { transaction_id: "X2", product: { id: "p" }, customer: { name: "B" }, amount: "0.29", status: "paid" });
    expect(t!.totalCents).toBe(29);
  });
  it("payload sem id de transação ou produto → null", () => {
    expect(mapSale("braip", { prod_key: "P" })).toBeNull();
    expect(mapSale("braip", { trans_key: "T" })).toBeNull();
    expect(mapSale("braip", null)).toBeNull();
  });
  it("status desconhecido cai em pendente (nunca marca pago por engano)", () => {
    expect(mapSale("b4you", { id: "1", product_id: "p", customer: { name: "C" }, total: 5, status: "alguma_coisa_nova" })!.paymentStatus).toBe("pendente");
  });
  it("todos os providers declarados têm mapeamento", () => {
    for (const p of PROVIDERS) expect(mapSale(p, { __vazio: true })).toBeNull();
  });
});
