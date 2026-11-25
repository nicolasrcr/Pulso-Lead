export function normalizeCpf(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

export function isValidCpf(v: string): boolean {
  const d = normalizeCpf(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

/** UI, logs e contexto de IA nunca recebem mais que os 2 últimos dígitos. */
export function maskCpf(v: string): string {
  const d = normalizeCpf(v);
  return d.length === 11 ? `***.***.***-${d.slice(9)}` : "***.***.***-**";
}

export function normalizePhone(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

export function maskPhone(v: string): string {
  const d = normalizePhone(v);
  if (d.length < 10) return "";
  return `(${d.slice(0, 2)}) *****-**${d.slice(-2)}`;
}
