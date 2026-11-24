import { isValidCpf, normalizeCpf, normalizePhone } from "./cpf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "1.234,56", "199,90", "R$ 7,05", "1234.56" → centavos inteiros. Nunca float; negativo e ambíguo = null. */
export function parseMoneyToCents(input: string): number | null {
  const s = input.replace(/^R\$\s*/i, "").trim();
  if (!s) return null;
  let intPart: string, frac = "";
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(s) || /^\d+(,\d{1,2})?$/.test(s)) {
    [intPart, frac = ""] = s.split(",") as [string, string?];
    intPart = intPart.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, frac = ""] = s.split(".") as [string, string?];
  } else return null;
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export interface ImportRow {
  externalId: string; planId: string; name: string; cpf?: string; phone?: string; email?: string;
  uf?: string; totalCents?: number; affiliateId?: string; paid: boolean;
}
export type ParsedRow = { ok: true; value: ImportRow } | { ok: false; error: string };

const get = (r: Record<string, string>, k: string) => (r[k] ?? "").trim();

/** Valida e normaliza uma linha da planilha de migração (colunas em pt-BR). */
export function parseImportRow(r: Record<string, string>): ParsedRow {
  const fail = (error: string): ParsedRow => ({ ok: false, error });
  const externalId = get(r, "id_externo");
  if (!externalId) return fail("id_externo obrigatório");
  if (externalId.length > 120) return fail("id_externo muito longo");
  const planId = get(r, "plano_id");
  if (!UUID.test(planId)) return fail("plano_id inválido");
  const name = get(r, "cliente");
  if (!name) return fail("cliente obrigatório");
  if (name.length > 120) return fail("cliente muito longo");
  const cpfRaw = get(r, "cpf");
  if (cpfRaw && !isValidCpf(cpfRaw)) return fail("cpf inválido");
  const email = get(r, "email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("email inválido");
  const ufRaw = get(r, "uf");
  if (ufRaw && !/^[A-Za-z]{2}$/.test(ufRaw)) return fail("uf inválida");
  const totalRaw = get(r, "total");
  const totalCents = totalRaw ? parseMoneyToCents(totalRaw) : undefined;
  if (totalCents === null) return fail("total inválido");
  const affiliateId = get(r, "afiliado_id");
  if (affiliateId && !UUID.test(affiliateId)) return fail("afiliado_id inválido");
  const phoneRaw = get(r, "telefone");
  return { ok: true, value: {
    externalId, planId, name,
    cpf: cpfRaw ? normalizeCpf(cpfRaw) : undefined, phone: phoneRaw ? normalizePhone(phoneRaw) : undefined,
    email: email || undefined, uf: ufRaw ? ufRaw.toUpperCase() : undefined, totalCents,
    affiliateId: affiliateId || undefined, paid: /^(sim|pago|1|true)$/i.test(get(r, "pago")),
  } };
}
