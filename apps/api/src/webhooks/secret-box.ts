import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/** Segredos em repouso (ex.: segredo do webhook): AES-256-GCM, base64(iv|tag|cifrado). Subchave por finalidade. */
export function makeSecretBox(keyHex: string, purpose = "webhook:secret") {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error("chave deve ter 64 hex");
  const key = createHmac("sha256", Buffer.from(keyHex, "hex")).update(purpose).digest();
  return {
    seal(plain: string): string {
      const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
    },
    open(sealed: string): string {
      const b = Buffer.from(sealed, "base64");
      const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
    },
  };
}
export type SecretBox = ReturnType<typeof makeSecretBox>;
