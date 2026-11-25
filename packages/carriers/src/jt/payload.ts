import type { ShipmentInput } from "@pulso/domain";
import { businessDigest, type JtCredentials } from "./digest";

export interface JtSender {
  name: string; company: string; postCode: string; taxNumber: string; phone: string;
  prov: string; city: string; area: string; street: string; streetNumber: string; complement?: string;
}
export class JtValidationError extends Error {}

const digits = (s: string) => s.replace(/\D/g, "");
/** Reais inteiros como string, sem decimais (regra validada na homologação J&T). */
const reais = (cents: number) => String(Math.round(cents / 100));

function party(name: string, company: string | undefined, o: {
  postCode: string; taxNumber: string; phone: string; prov: string; city: string; area: string;
  street: string; streetNumber: string; complement?: string;
}) {
  const phone = digits(o.phone);
  const postCode = digits(o.postCode);
  if (postCode.length !== 8) throw new JtValidationError(`CEP inválido: precisa de 8 dígitos (${o.postCode})`);
  const tax = digits(o.taxNumber);
  if (tax.length !== 11 && tax.length !== 14) throw new JtValidationError("documento (CPF/CNPJ) inválido");
  return {
    name, ...(company ? { company } : {}), postCode, taxNumber: tax, mobile: phone, phone,
    prov: o.prov, city: o.city, area: o.area, street: o.street, streetNumber: o.streetNumber,
    address: o.complement || "SEM COMPLEMENTO", areaCode: phone.slice(0, 2), ieNumber: "ISENTO",
  };
}

export function buildAddOrder(cred: JtCredentials, s: JtSender, i: ShipmentInput, txlogisticId: string) {
  const d = i.destination;
  if (!i.recipientDocument) throw new JtValidationError("documento do destinatário obrigatório");
  if (!i.recipientPhone) throw new JtValidationError("telefone do destinatário obrigatório");
  if (!i.items?.length || i.totalCents === undefined) throw new JtValidationError("itens e total obrigatórios");
  if (!i.invoice) throw new JtValidationError("nota fiscal obrigatória para etiqueta J&T");
  if (!/^\d{44}$/.test(i.invoice.accessKey)) throw new JtValidationError("chave da NF-e precisa ter exatamente 44 dígitos");
  const kg = i.parcel.weightGrams / 1000;
  if (kg < 0.01 || kg > 30) throw new JtValidationError("peso fora do intervalo 0,01–30 kg");

  const sender = party(s.name, s.company, { ...s, taxNumber: s.taxNumber, phone: s.phone });
  const receiver = party(i.recipientName, undefined, {
    postCode: d.zip, taxNumber: i.recipientDocument, phone: i.recipientPhone, prov: d.uf, city: d.city ?? "",
    area: d.district ?? "", street: d.street ?? "", streetNumber: d.number ?? "S/N", complement: d.complement,
  });
  const total = reais(i.totalCents);
  return {
    customerCode: cred.customerCode, digest: businessDigest(cred), txlogisticId,
    expressType: "EZ", orderType: "2", serviceType: "02", deliveryType: "03", payType: "PP_PM",
    sender, receiver, translate: { ...sender },
    goodsType: "bm000006",
    length: Math.round(i.parcel.lengthCm), width: Math.round(i.parcel.widthCm), height: Math.round(i.parcel.heightCm),
    weight: String(kg), totalQuantity: i.items.reduce((t, x) => t + x.quantity, 0),
    itemsValue: total, priceCurrency: "BRL", remark: `Pedido ${i.orderId}`,
    items: i.items.map((x) => ({
      itemType: "bm000006", itemName: x.name, number: String(x.quantity), itemValue: reais(x.unitCents),
      priceCurrency: "BRL", desc: x.name, itemNcm: x.ncm ?? "00000000",
    })),
    docType: 0, invoiceType: "NFe", invoiceNumber: i.invoice.number, invoiceSerialNumber: i.invoice.series,
    invoiceMoney: total, taxCode: digits(i.invoice.issuerTaxId), invoiceAccessKey: i.invoice.accessKey,
    invoiceIssueDate: i.invoice.issuedAt,
  };
}

export function buildCancel(cred: JtCredentials, txlogisticId: string, reason: string) {
  return { customerCode: cred.customerCode, digest: businessDigest(cred), txlogisticId, reason, orderType: "2" };
}
