import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { businessDigest, headerDigest, JT_PWD_SALT } from "../src/jt/digest";

const md5hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const md5b64 = (s: string) => createHash("md5").update(s, "utf8").digest("base64");

describe("J&T Double Digest", () => {
  it("business digest = b64(md5(code + MD5(senha+salt).UPPER + key))", () => {
    const pwd = md5hex(`segredo${JT_PWD_SALT}`).toUpperCase();
    expect(businessDigest({ customerCode: "C1", password: "segredo", privateKey: "K" }))
      .toBe(md5b64(`C1${pwd}K`));
  });
  it("header digest = b64(md5(bizContent + key)) sobre a MESMA string enviada", () => {
    expect(headerDigest('{"a":1}', "K")).toBe(md5b64('{"a":1}K'));
  });
  it("salt fixo documentado", () => { expect(JT_PWD_SALT).toBe("jadada236t2"); });
});
