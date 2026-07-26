import { themeById } from "@/src/data/themes";
import type { DesignTokens } from "./schema";

/**
 * The REVERSE bridge: maps a purchased design's `--d-*` tokens onto the `fp-*` CSS
 * variables the existing customer dashboard (and default storefront chrome) use, so a
 * signed-in customer's dashboard picks up the active design's palette. Colours + a few
 * shape tokens only — no layout or logic changes. `overrides` lets a free colour theme
 * recolour the design first (same precedence as the landing).
 */
export function designToThemeVars(tokens: DesignTokens, overrides?: Partial<DesignTokens>): Record<string, string> {
  const t = { ...tokens, ...(overrides ?? {}) };
  return {
    "--void": t.bg,
    "--void-2": t.bgAlt,
    "--panel": t.surface,
    "--panel-raised": t.surfaceAlt,
    "--line": t.border,
    "--line-soft": t.border,
    "--text": t.text,
    "--text-dim": t.textDim,
    "--text-faint": t.textFaint,
    "--gold": t.accent,
    "--gold-light": t.accentAlt,
    "--violet": t.accentAlt,
    // Accent tints — color-mix handles hex or rgba accents cleanly.
    "--gold-soft": `color-mix(in srgb, ${t.accent} 14%, transparent)`,
    "--gold-soft-border": `color-mix(in srgb, ${t.accent} 32%, transparent)`,
  };
}

/**
 * Bridges the FREE colour themes (which are `fp-*` CSS-variable sets) onto a purchased
 * design's tokens, so an owner can recolour a bought design instead of being stuck with
 * its shipped palette. Only colours are mapped — the design keeps its own layout,
 * typography, radii, shadows and animation (that's what makes it a distinct design).
 *
 * Returns {} for the default theme with no custom accent, so a design renders exactly
 * as its designer intended unless the owner actively picks a theme/accent.
 */
export function themeToDesignTokens(themeId?: string | null, accent?: string | null): Partial<DesignTokens> {
  const out: Partial<DesignTokens> = {};
  const theme = themeById(themeId);
  const v = theme.vars ?? {};

  // Surfaces + text come from the theme's token set when it defines them.
  const map: Array<[keyof DesignTokens, string]> = [
    ["bg", "--void"],
    ["bgAlt", "--void-2"],
    ["surface", "--panel"],
    ["surfaceAlt", "--panel-raised"],
    ["border", "--line"],
    ["text", "--text"],
    ["textDim", "--text-dim"],
    ["textFaint", "--text-faint"],
    ["accent", "--gold"],
    ["accentAlt", "--violet"],
  ];
  for (const [token, cssVar] of map) {
    const value = v[cssVar];
    if (typeof value === "string" && value) out[token] = value;
  }

  // A themed design shouldn't keep the original's decorative backdrop tint, which is
  // tuned to its own palette.
  if (Object.keys(out).length > 0) out.backdrop = "none";

  // An explicit custom accent always wins.
  const a = accent?.trim();
  if (a) {
    out.accent = a;
    out.accentAlt = a;
  }
  return out;
}
