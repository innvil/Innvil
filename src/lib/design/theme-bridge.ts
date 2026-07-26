import { themeById } from "@/src/data/themes";
import type { DesignTokens } from "./schema";

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
