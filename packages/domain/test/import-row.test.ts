import { describe, it, expect } from "vitest";
import { parseMoneyToCents, parseImportRow } from "../src/import-row";

describe("dinheiro de planilha → centavos inteiros", () => {
  it.each([["199,90", 19990], ["1.234,56", 123456], ["10", 1000], ["0,5", 50], ["R$ 7,05", 705], ["1234.56", 123456], ["0", 0]])("%s", (i, o) => expect(parseMoneyToCents(i)).toBe(o));
  it.each(["", "abc", "-5", "1,234,56", "1.2.3", "10,999", "R$"])("recusa %j", (i) => expect(parseMoneyToCents(i)).toBeNull());
});

describe("linha de importação", () => {
  const ok = { id_externo: "A-1", plano_id: "11111111-1111-1111-1111-111111111111", cliente: "Maria", cpf: "529.982.247-25", telefone: "(61) 99999-1234", email: "m@x.co", uf: "df", total: "199,90" };
  it("normaliza campos válidos", () => {
    const r = parseImportRow(ok);
    expect(r).toEqual({ ok: true, value: { externalId: "A-1", planId: ok.plano_id, name: "Maria", cpf: "52998224725", phone: "61999991234", email: "m@x.co", uf: "DF", totalCents: 19990, affiliateId: undefined, paid: false } });
  });
  it("campos opcionais ausentes são aceitos", () => {
    const r = parseImportRow({ id_externo: "B", plano_id: ok.plano_id, cliente: "Ana" });
    expect(r.ok && r.value.cpf).toBeUndefined();
    expect(r.ok && r.value.totalCents).toBeUndefined();
  });
  it("reporta o primeiro erro com o nome da coluna", () => {
    expect(parseImportRow({ ...ok, id_externo: "" })).toEqual({ ok: false, error: "id_externo obrigatório" });
    expect(parseImportRow({ ...ok, plano_id: "x" })).toEqual({ ok: false, error: "plano_id inválido" });
    expect(parseImportRow({ ...ok, cliente: " " })).toEqual({ ok: false, error: "cliente obrigatório" });
    expect(parseImportRow({ ...ok, cpf: "11111111111" })).toEqual({ ok: false, error: "cpf inválido" });
    expect(parseImportRow({ ...ok, uf: "XYZ" })).toEqual({ ok: false, error: "uf inválida" });
    expect(parseImportRow({ ...ok, total: "dez" })).toEqual({ ok: false, error: "total inválido" });
    expect(parseImportRow({ ...ok, email: "sem-arroba" })).toEqual({ ok: false, error: "email inválido" });
  });
  it("limita o tamanho dos textos", () => {
    expect(parseImportRow({ ...ok, id_externo: "x".repeat(121) })).toEqual({ ok: false, error: "id_externo muito longo" });
  });
});
