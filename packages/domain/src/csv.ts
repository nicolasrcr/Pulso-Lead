const FORMULA = /^[=+\-@\t\r]/;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  let s = String(v);
  if (FORMULA.test(s)) s = `'${s}`; // CSV injection: o Excel executaria =, +, -, @
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Gera CSV (CRLF). Números passam crus; texto que começa com =,+,-,@ é neutralizado. */
export function toCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Lê CSV com cabeçalho. Detecta `,` ou `;`, aceita BOM, CRLF e campos entre aspas. */
export function parseCsv(text: string, opts: { maxRows?: number } = {}): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      i++; row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      if (opts.maxRows !== undefined && rows.length > opts.maxRows + 1) throw new RangeError(`excede ${opts.maxRows} linhas`);
      continue;
    }
    field += ch; i++;
  }
  if (quoted) throw new SyntaxError("aspas não fechadas");
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  if (opts.maxRows !== undefined && rows.length - 1 > opts.maxRows) throw new RangeError(`excede ${opts.maxRows} linhas`);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h.trim(), r[k] ?? ""])));
}
