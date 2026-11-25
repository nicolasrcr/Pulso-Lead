import { describe, it, expect } from "vitest";
import { buildAddOrder, buildCancel, JtSender } from "../src/jt/payload";
import type { ShipmentInput } from "@pulso/domain";

const sender: JtSender = {
  name: "REMETENTE", company: "EMPRESA", postCode: "70000-000", taxNumber: "62.333.509/0001-03",
  phone: "(61) 99999-9999", prov: "DF", city: "BRASILIA", area: "ASA SUL", street: "RUA X", streetNumber: "100",
};
const input: ShipmentInput = {
  orderId: "PED1", recipientName: "Fulano", recipientDocument: "123.456.789-09", recipientPhone: "(11) 98888-7777",
  destination: { zip: "01001-000", uf: "SP", city: "SAO PAULO", street: "PRACA SE", number: "1", district: "SE" },
  parcel: { weightGrams: 1500, lengthCm: 20, widthCm: 15, heightCm: 10 },
  items: [{ name: "Item A", quantity: 2, unitCents: 7_550, ncm: "12345678" }],
  totalCents: 15_100,
  invoice: { number: "10", series: "1", accessKey: "0".repeat(44), issuedAt: "2026-11-01 10:00:00", issuerTaxId: "62333509000103" },
};
const cred = { customerCode: "C1", password: "p", privateKey: "K", apiAccount: "A" };

describe("buildAddOrder", () => {
  const p = buildAddOrder(cred, sender, input, "LOJA-PED1");
  it("campos fixos validados em homologação", () => {
    expect(p).toMatchObject({ payType: "PP_PM", expressType: "EZ", orderType: "2", serviceType: "02", deliveryType: "03", txlogisticId: "LOJA-PED1" });
  });
  it("translate é cópia exata do sender (normalizado)", () => {
    expect(p.translate).toEqual(p.sender);
    expect(p.translate).not.toBe(p.sender);
  });
  it("CEP 8 dígitos sem hífen, documentos e telefones só números", () => {
    expect(p.sender.postCode).toBe("70000000");
    expect(p.receiver.postCode).toBe("01001000");
    expect(p.receiver.taxNumber).toBe("12345678909");
    expect(p.receiver.mobile).toBe("11988887777");
    expect(p.receiver.areaCode).toBe("11");
    expect(p.sender.taxNumber).toBe("62333509000103");
  });
  it("valores monetários inteiros em reais, como string, sem decimais", () => {
    expect(p.itemsValue).toBe("151");
    expect(p.items[0]!.itemValue).toBe("76");
    expect(p.invoiceMoney).toBe("151");
    expect(p.itemsValue).not.toMatch(/\./);
  });
  it("peso em kg string, dimensões numéricas, quantidade somada", () => {
    expect(p.weight).toBe("1.5");
    expect(p.length).toBe(20);
    expect(p.totalQuantity).toBe(2);
    expect(p.items[0]!.number).toBe("2");
  });
  it("chave NF exatamente 44 dígitos", () => {
    expect(p.invoiceAccessKey).toHaveLength(44);
    expect(() => buildAddOrder(cred, sender, { ...input, invoice: { ...input.invoice!, accessKey: "123" } }, "X")).toThrow(/44/);
  });
  it("recusa CEP inválido e dados obrigatórios ausentes", () => {
    expect(() => buildAddOrder(cred, sender, { ...input, destination: { ...input.destination, zip: "123" } }, "X")).toThrow(/CEP/);
    expect(() => buildAddOrder(cred, sender, { ...input, recipientDocument: undefined }, "X")).toThrow(/documento/);
    expect(() => buildAddOrder(cred, sender, { ...input, invoice: undefined }, "X")).toThrow(/nota fiscal/i);
  });
  it("peso fora de 0.01–30 kg é recusado", () => {
    expect(() => buildAddOrder(cred, sender, { ...input, parcel: { ...input.parcel, weightGrams: 31_000 } }, "X")).toThrow(/peso/i);
  });
});

describe("buildCancel", () => {
  it("usa reason e orderType '2'", () => {
    const c = buildCancel(cred, "LOJA-PED1", "cliente desistiu");
    expect(c).toMatchObject({ txlogisticId: "LOJA-PED1", reason: "cliente desistiu", orderType: "2", customerCode: "C1" });
    expect(c).not.toHaveProperty("cancelReason");
  });
});
