// Tokens provisórios: tema claro, índigo como cor da marca (BLUEPRINT D14).
// A paleta e as fontes finais saem do Coolors (https://coolors.co/) e substituem estes valores sem mudar a API.
export const tokens = {
  color: {
    brand: "#4338CA", onBrand: "#FFFFFF", surface: "#FFFFFF", background: "#F6F7FB",
    text: "#111827", muted: "#4B5563", border: "#E5E7EB",
    success: "#047857", warning: "#B45309", danger: "#B91C1C",
  },
  font: { sans: "Inter, system-ui, sans-serif" },
  radius: { sm: "6px", md: "10px", lg: "16px" },
  space: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px" },
} as const;

export function toCssVariables(t: typeof tokens): string {
  const lines: string[] = [];
  for (const [group, values] of Object.entries(t)) {
    for (const [k, v] of Object.entries(values)) lines.push(`  --${group}-${k}: ${v};`);
  }
  return `:root {\n${lines.join("\n")}\n}`;
}

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
