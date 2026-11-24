import { createHash } from "node:crypto";

export const JT_PWD_SALT = "jadada236t2";
const md5 = (s: string) => createHash("md5").update(s, "utf8");

export interface JtCredentials { customerCode: string; password: string; privateKey: string; apiAccount: string }

/** Business Digest (vai dentro do bizContent). */
export function businessDigest(c: Pick<JtCredentials, "customerCode" | "password" | "privateKey">): string {
  const pwd = md5(`${c.password}${JT_PWD_SALT}`).digest("hex").toUpperCase();
  return md5(`${c.customerCode}${pwd}${c.privateKey}`).digest("base64");
}

/** Header Digest: calculado sobre a MESMA string bizContent enviada no corpo. */
export function headerDigest(bizContent: string, privateKey: string): string {
  return md5(`${bizContent}${privateKey}`).digest("base64");
}
