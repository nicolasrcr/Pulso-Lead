import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateV4(h: string): boolean {
  const p = h.split(".").map(Number) as [number, number, number, number];
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}

function internalIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return privateV4(ip);
  if (v === 6) {
    const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
    return v4mapped ? privateV4(v4mapped) : /^(::1?|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(ip) || ip === "::";
  }
  return true; // não é IP: falha fechada
}

export type Resolver = (host: string) => Promise<string[]>;
export const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Segunda barreira contra SSRF: resolve o host e recusa a entrega se QUALQUER endereço for interno (cobre DNS que
 * aponta para rede privada). Falha fechada em erro de DNS ou resposta vazia. IP literal não consulta DNS.
 * Limite conhecido: entre esta checagem e a conexão o DNS pode mudar (rebinding); só fixar o IP na conexão fecha isso.
 */
export async function assertResolvedPublic(raw: string, resolve: Resolver = dnsResolver): Promise<void> {
  const u = assertPublicUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  const ips = await resolve(host);
  if (ips.length === 0) throw new Error("host sem endereço");
  if (ips.some(internalIp)) throw new Error("destino interno");
}

/**
 * Só https, sem credenciais, e nunca destinos internos (SSRF). Cobre hostnames óbvios e IP literais.
 * O IP resolvido é validado na entrega por `assertResolvedPublic`.
 */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("URL inválida"); }
  if (u.protocol !== "https:") throw new Error("somente https");
  if (u.username || u.password) throw new Error("URL com credenciais não é permitida");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) throw new Error("destino interno");
  const ip = isIP(host);
  if (ip === 4 && privateV4(host)) throw new Error("destino interno");
  if (ip === 6) {
    const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)?.[1];
    if (v4mapped ? privateV4(v4mapped) : /^(::1?|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/.test(host) || host === "::") throw new Error("destino interno");
    if (v4mapped) return u;
  }
  return u;
}
