export interface BomItem { stockItemId: string; qty: number }
export interface Movement { stockItemId: string; delta: number; reason: "release" }
export type ReleasePlan =
  | { ok: true; movements: Movement[] }
  | { ok: false; missing: { stockItemId: string; needed: number; available: number }[] };

/**
 * Calcula a baixa de estoque de uma liberação. Pura: não toca no banco.
 * A atomicidade e a unicidade vêm do banco (app.release_order + índice stock_release_once);
 * este plano serve para validar e explicar a falta antes de tentar.
 */
export function planRelease(bom: readonly BomItem[], units: number, balances: Readonly<Record<string, number>>): ReleasePlan {
  if (!Number.isInteger(units) || units < 1) throw new RangeError("units deve ser inteiro >= 1");
  const needed = new Map<string, number>();
  for (const b of bom) {
    if (!Number.isInteger(b.qty) || b.qty < 1) throw new RangeError("qty da BOM deve ser inteiro >= 1");
    needed.set(b.stockItemId, (needed.get(b.stockItemId) ?? 0) + b.qty * units);
  }
  const missing = [...needed]
    .map(([stockItemId, n]) => ({ stockItemId, needed: n, available: balances[stockItemId] ?? 0 }))
    .filter((x) => x.available < x.needed);
  if (missing.length) return { ok: false, missing };
  return { ok: true, movements: [...needed].map(([stockItemId, n]) => ({ stockItemId, delta: -n, reason: "release" as const })) };
}
