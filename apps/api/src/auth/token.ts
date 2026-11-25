import { createHash, randomBytes } from "node:crypto";

/** Token opaco: 32 bytes aleatórios. Só o SHA-256 vai para o banco (sessions.token_hash). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
