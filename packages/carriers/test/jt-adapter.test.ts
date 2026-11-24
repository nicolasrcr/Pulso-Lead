import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { JtAdapter, JtApiError, type JtRequest, type JtTransport } from "../src/jt/adapter";
import { runCarrierContract } from "@pulso/domain/src/carrier-contract";

const cred = { customerCode: "C1", password: "p", privateKey: "K", apiAccount: "A" };
const sender = { name: "R", company: "E", postCode: "70000000", taxNumber: "62333509000103", phone: "61999999999", prov: "DF", city: "BRASILIA", area: "ASA SUL", street: "RUA X", streetNumber: "1" };

function fakeTransport(log: JtRequest[] = []): JtTransport {
  let n = 0;
  return async (req) => {
    log.push(req);
    if (req.url.endsWith("/addOrder")) return { status: 200, json: { code: "1", data: { orderList: [{ billCode: `JT${++n}` }] } } };
    if (req.url.endsWith("/cancelOrder")) return { status: 200, json: { code: "1" } };
    if (req.url.endsWith("/checkFreight")) return { status: 200, json: { code: "1", data: { freight: "18.90", days: 4 } } };
    return { status: 200, json: { code: "1", data: [{ details: [
      { scanType: "Saída para entrega", scanTime: "2026-11-03 09:00:00" },
      { scanType: "Coleta", scanTime: "2026-11-01 10:00:00" },
    ] }] } };
  };
}
const make = (log?: JtRequest[], env: "homolog" | "production" = "homolog") =>
  new JtAdapter({ credentials: cred, sender, env, transport: fakeTransport(log), labelBaseUrl: "https://app.exemplo.com/labels", now: () => 1_700_000_000_000 });

// O contrato mínimo não traz NF/itens: o J&T exige — então o contrato roda com os extras via wrapper.
const full = {
  recipientDocument: "12345678909", recipientPhone: "11988887777", totalCents: 10_000,
  items: [{ name: "X", quantity: 1, unitCents: 10_000 }],
  invoice: { number: "1", series: "1", accessKey: "0".repeat(44), issuedAt: "2026-11-01 10:00:00", issuerTaxId: "62333509000103" },
};
runCarrierContract("J&T (transporte mockado)", () => {
  const a = make();
  const orig = a.createShipment.bind(a);
  a.createShipment = (i) => orig({ ...full, ...i });
  return a;
});

describe("JtAdapter — protocolo", () => {
  it("assina o corpo enviado: header digest confere com o bizContent exato", async () => {
    const log: JtRequest[] = [];
    await make(log).createShipment({ orderId: "P1", destination: { zip: "01001000", uf: "SP", city: "SP", street: "R", number: "1", district: "D" }, parcel: { weightGrams: 500, lengthCm: 10, widthCm: 10, heightCm: 10 }, recipientName: "F", ...full });
    const r = log[0]!;
    const biz = new URLSearchParams(r.body).get("bizContent")!;
    expect(r.headers.digest).toBe(createHash("md5").update(biz + "K").digest("base64"));
    expect(r.headers.apiAccount).toBe("A");
    expect(r.headers.timestamp).toBe("1700000000000");
    expect(r.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(r.url).toBe("https://demoopenapi.jtjms-br.com/webopenplatformapi/api/order/addOrder");
  });
  it("produção usa o host de produção", async () => {
    const log: JtRequest[] = [];
    await make(log, "production").quote({ origin: { zip: "70040010", uf: "DF" }, destination: { zip: "01001000", uf: "SP" }, parcel: { weightGrams: 500, lengthCm: 1, widthCm: 1, heightCm: 1 } });
    expect(log[0]!.url.startsWith("https://openapi.jtjms-br.com/")).toBe(true);
  });
  it("cancela com txlogisticId do pedido criado, reason e orderType 2", async () => {
    const log: JtRequest[] = [];
    const a = make(log);
    const s = await a.createShipment({ orderId: "P2", destination: { zip: "01001000", uf: "SP", city: "SP", street: "R", number: "1", district: "D" }, parcel: { weightGrams: 500, lengthCm: 10, widthCm: 10, heightCm: 10 }, recipientName: "F", ...full });
    await a.cancel(s.trackingCode);
    const body = JSON.parse(new URLSearchParams(log[1]!.body).get("bizContent")!);
    expect(body).toMatchObject({ txlogisticId: "PL-P2", orderType: "2" });
    expect(body.reason).toBeTruthy();
  });
  it("cancel de código desconhecido lança erro explícito", async () => {
    await expect(make().cancel("NAOEXISTE")).rejects.toThrow(JtApiError);
  });
  it("cancel resolve txlogisticId via resolveTxId (após restart)", async () => {
    const a = new JtAdapter({ credentials: cred, sender, env: "homolog", transport: fakeTransport(), labelBaseUrl: "https://x.test", resolveTxId: async () => "PL-Z" });
    expect((await a.cancel("JT9")).cancelled).toBe(true);
  });
  it("código != 1 vira JtApiError com o código da J&T", async () => {
    const a = new JtAdapter({ credentials: cred, sender, env: "homolog", labelBaseUrl: "https://x.test", transport: async () => ({ status: 200, json: { code: "145003050", msg: "Illegal parameters" } }) });
    await expect(a.quote({ origin: { zip: "1", uf: "DF" }, destination: { zip: "2", uf: "SP" }, parcel: { weightGrams: 1, lengthCm: 1, widthCm: 1, heightCm: 1 } })).rejects.toMatchObject({ code: "145003050" });
  });
  it("track ordena cronologicamente e normaliza", async () => {
    const ev = await make().track("JT1");
    expect(ev.map((e) => e.status)).toEqual(["coletado", "rota_entrega"]);
    expect(ev[0]!.occurredAt.toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });
  it("evento desconhecido → desconhecido, preserva rawCode", () => {
    const e = make().normalizeEvent({ code: "XYZ", occurredAt: new Date(), trackingCode: "J" });
    expect(e).toMatchObject({ status: "desconhecido", rawCode: "XYZ" });
  });
});
