const nf = new Intl.NumberFormat("pt-BR");
/** Centavos inteiros -> "R$ 1.234,56" sem passar por float de dinheiro. */
export function formatBrl(cents: number): string {
  const neg = cents < 0, abs = Math.abs(cents);
  const s = `R$ ${nf.format(Math.floor(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100), frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole},${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}
