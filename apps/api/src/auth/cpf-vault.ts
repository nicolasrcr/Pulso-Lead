import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { normalizeCpf } from "@pulso/domain";

/**
 * CPF: AES-256-GCM (iv 12 | tag 16 | cifrado) + HMAC-SHA256 para busca/duplicidade.
 * A chave vem do ambiente (CPF_KEY, 64 hex) e nunca é gravada no banco. Subchaves separadas por finalidade.
 */
export function makeCpfVault(keyHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error("CPF_KEY deve ter 64 caracteres hexadecimais (32 bytes)");
  const master = Buffer.from(keyHex, "hex");
  const sub = (label: string) => createHmac("sha256", master).update(label).digest();
  const encKey = sub("cpf:enc"), hashKey = sub("cpf:hash");
  return {
    encrypt(cpf: string): Buffer {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", encKey, iv);
      const body = Buffer.concat([c.update(normalizeCpf(cpf), "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decrypt(buf: Buffer): string {
      const d = createDecipheriv("aes-256-gcm", encKey, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    },
    hash(cpf: string): string {
      return createHmac("sha256", hashKey).update(normalizeCpf(cpf)).digest("hex");
    },
  };
}
export type CpfVault = ReturnType<typeof makeCpfVault>;
