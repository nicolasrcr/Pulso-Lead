import { formatBps, formatBrl } from "./format";

/** "12,34" | "1.234,5" | "197.90" | "100" → centavos inteiros (sem float). null se inválido. */
export function parseMoneyToCents(text: string): number | null {
  const s = text.trim().replace(/^R\$\s*/, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  let intPart: string, frac = "";
  if (lc >= 0 && ld >= 0) {
    const sep = Math.max(lc, ld);
    intPart = s.slice(0, sep).replace(/[.,]/g, ""); frac = s.slice(sep + 1);
  } else if (lc >= 0 || ld >= 0) {
    const ch = lc >= 0 ? "," : ".", parts = s.split(ch);
    if (parts.length > 2) {
      if (ch === ",") return null;
      if (!parts.slice(1).every((p) => p.length === 3)) return null; // 1.234.567
      intPart = parts.join("");
    } else if (parts[1]!.length === 3 && ch === ".") { intPart = parts.join(""); } // 1.234 = mil duzentos e trinta e quatro
    else { intPart = parts[0]!; frac = parts[1]!; }
  } else intPart = s;
  if (!/^\d+$/.test(intPart) || (frac && !/^\d{1,2}$/.test(frac))) return null;
  return Number(intPart) * 100 + Number((frac + "00").slice(0, 2));
}

/** "12,5" → 1250 bps. Aceita 0–100 com até 2 casas. */
export function parsePercentToBps(text: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
  return bps <= 10_000 ? bps : null;
}

export type CommissionRule = { type: "percent"; bps: number } | { type: "fixed"; cents: number };
export function buildCommissionRule(type: "percent" | "fixed", text: string): CommissionRule | null {
  if (type === "percent") { const bps = parsePercentToBps(text); return bps === null ? null : { type, bps }; }
  const cents = parseMoneyToCents(text);
  return cents === null ? null : { type, cents };
}
export function describeRule(r: { type?: string; bps?: number; cents?: number }): string {
  if (r.type === "percent" && Number.isInteger(r.bps)) return `${formatBps(r.bps!)} do pedido`;
  if (r.type === "fixed" && Number.isInteger(r.cents)) return `${formatBrl(r.cents!)} fixo`;
  return "regra desconhecida";
}

/** <input type="datetime-local"> ("2026-11-01T10:00") → "2026-11-01 10:00:00" (formato da NF-e na J&T). */
export function parseBrDateTimeLocal(v: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
  return m ? `${m[1]} ${m[2]}:00` : null;
}
