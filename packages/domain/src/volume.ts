export interface VolumeRecord { orderId: string; source: "created" | "imported"; at: Date }
export type VolumeAlert = "80" | "100" | null;

/** Mês-calendário no fuso de Brasília (UTC-3). */
export function monthKey(d: Date): string {
  const br = new Date(d.getTime() - 3 * 3_600_000);
  return `${br.getUTCFullYear()}-${String(br.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Conta pedidos criados OU importados, sem duplicar por id. Informa; nunca bloqueia. */
export class VolumeCounter {
  private seen = new Map<string, Set<string>>();
  private alerted = new Map<string, Set<"80" | "100">>();
  constructor(private readonly cap: number) {}

  record(r: VolumeRecord): { accepted: true; counted: boolean; alert: VolumeAlert } {
    const m = monthKey(r.at);
    const set = this.seen.get(m) ?? new Set<string>();
    this.seen.set(m, set);
    if (set.has(r.orderId)) return { accepted: true, counted: false, alert: null };
    set.add(r.orderId);
    const done = this.alerted.get(m) ?? new Set<"80" | "100">();
    this.alerted.set(m, done);
    let alert: VolumeAlert = null;
    if (set.size >= this.cap && !done.has("100")) { done.add("100"); alert = "100"; }
    else if (set.size >= Math.ceil(this.cap * 0.8) && !done.has("80")) { done.add("80"); alert = "80"; }
    return { accepted: true, counted: true, alert };
  }

  countFor(month: string): number {
    return this.seen.get(month)?.size ?? 0;
  }
}
