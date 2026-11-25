/** Janela fixa em memória, por chave. Suficiente para uma instância; com várias, mover para Redis (BullMQ/Fase infra). */
export function makeLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    take(key: string): boolean {
      const t = now();
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      const h = hits.get(key);
      if (!h || h.reset <= t) { hits.set(key, { n: 1, reset: t + windowMs }); return true; }
      h.n++;
      return h.n <= max;
    },
  };
}
