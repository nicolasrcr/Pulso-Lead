import { describe, it, expect } from "vitest";
import { tokens, toCssVariables, contrastRatio } from "../src/index";

describe("design tokens", () => {
  it("texto principal sobre superfície atinge WCAG AA (>= 4.5)", () => {
    expect(contrastRatio(tokens.color.text, tokens.color.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("texto sobre a cor da marca (botão primário) atinge AA", () => {
    expect(contrastRatio(tokens.color.onBrand, tokens.color.brand)).toBeGreaterThanOrEqual(4.5);
  });
  it("gera variáveis CSS a partir dos tokens (sem valores fixos nas telas)", () => {
    const css = toCssVariables(tokens);
    expect(css).toContain("--color-brand:");
    expect(css).toContain("--radius-md:");
  });
});
