/* =========================================================
   PANEL THEMES — each maps to a set of CSS-variable overrides
   applied on the storefront root, so a panel owner's chosen theme
   actually drives the customer-facing look. Client + server safe.
   ========================================================= */

export interface ThemeDef {
  id: string;
  label: string;
  a: string; // swatch color 1 (accent)
  b: string; // swatch color 2 (surface)
  seasonal?: boolean; // grouped under "Seasonal" in the picker
  vars: Record<string, string>; // CSS variable overrides
}

export const THEMES: ThemeDef[] = [
  {
    id: "obsidian-gold",
    label: "Obsidian Gold",
    a: "#C9A574",
    b: "#0D0F14",
    vars: {}, // the default token set
  },
  {
    id: "violet-night",
    label: "Violet Night",
    a: "#8B7FFF",
    b: "#0D0F14",
    vars: {
      "--gold": "#8B7FFF",
      "--gold-light": "#A89FFF",
      "--gold-soft": "rgba(139,127,255,0.12)",
      "--gold-soft-border": "rgba(139,127,255,0.30)",
    },
  },
  {
    id: "ivory-minimal",
    label: "Ivory Minimal",
    a: "#8A8470",
    b: "#F4F2EC",
    vars: {
      "--void": "#F6F4EF",
      "--void-2": "#EEEBE3",
      "--panel": "#FFFFFF",
      "--panel-raised": "#F3F1EA",
      "--line": "#E4E1D8",
      "--line-soft": "#EDEBE3",
      "--text": "#1B1B1B",
      "--text-dim": "#585A63",
      "--text-faint": "#9A9CA6",
      "--gold": "#96773F",
      "--gold-light": "#B99A5E",
      "--gold-soft": "rgba(150,119,63,0.10)",
      "--gold-soft-border": "rgba(150,119,63,0.25)",
    },
  },
  {
    id: "neon-slate",
    label: "Neon Slate",
    a: "#2DD4BF",
    b: "#0D0F14",
    vars: {
      "--gold": "#2DD4BF",
      "--gold-light": "#5EEAD4",
      "--gold-soft": "rgba(45,212,191,0.10)",
      "--gold-soft-border": "rgba(45,212,191,0.28)",
      "--violet": "#38BDF8",
      "--violet-light": "#7DD3FC",
    },
  },

  /* -------- Seasonal (free) -------- */
  {
    id: "christmas",
    label: "Christmas",
    a: "#E23B3B",
    b: "#1A6B3A",
    seasonal: true,
    vars: {
      "--gold": "#E23B3B",
      "--gold-light": "#F26D6D",
      "--gold-soft": "rgba(226,59,59,0.10)",
      "--gold-soft-border": "rgba(226,59,59,0.28)",
      "--violet": "#2EA25B",
      "--violet-light": "#5DC888",
    },
  },
  {
    id: "autumn",
    label: "Autumn / Fall",
    a: "#D9822B",
    b: "#7A3E15",
    seasonal: true,
    vars: {
      "--gold": "#D9822B",
      "--gold-light": "#EBA85A",
      "--gold-soft": "rgba(217,130,43,0.10)",
      "--gold-soft-border": "rgba(217,130,43,0.28)",
      "--violet": "#C0552E",
      "--violet-light": "#DB7C54",
    },
  },
  {
    id: "winter",
    label: "Winter Frost",
    a: "#5AA9E6",
    b: "#0D1B2A",
    seasonal: true,
    vars: {
      "--void": "#0B1622",
      "--void-2": "#0E1B29",
      "--panel": "#132433",
      "--panel-raised": "#18314A",
      "--gold": "#5AA9E6",
      "--gold-light": "#8FD0FF",
      "--gold-soft": "rgba(90,169,230,0.10)",
      "--gold-soft-border": "rgba(90,169,230,0.30)",
      "--violet": "#7FE4E4",
      "--violet-light": "#AEF3F3",
    },
  },
  {
    id: "spring",
    label: "Spring Bloom",
    a: "#6FCF97",
    b: "#E8A5C4",
    seasonal: true,
    vars: {
      "--gold": "#6FCF97",
      "--gold-light": "#9BE3B7",
      "--gold-soft": "rgba(111,207,151,0.10)",
      "--gold-soft-border": "rgba(111,207,151,0.30)",
      "--violet": "#E28FB8",
      "--violet-light": "#F0B4D2",
    },
  },
];

export const DEFAULT_THEME = "obsidian-gold";

/** Resolve a theme by id (or legacy label); falls back to the default. */
export function themeById(id?: string | null): ThemeDef {
  if (!id) return THEMES[0];
  const k = id.toLowerCase();
  return (
    THEMES.find((t) => t.id === k) ??
    THEMES.find((t) => t.label.toLowerCase() === k) ??
    THEMES[0]
  );
}

function hexToRgba(hex: string, alpha: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * CSS-variable map for a theme + optional custom accent (from the Design Studio).
 * Apply as an inline `style` on the storefront root — fp-* classes read the vars.
 */
export function themeVars(themeId?: string | null, accent?: string | null): Record<string, string> {
  const t = themeById(themeId);
  const vars: Record<string, string> = { ...t.vars };
  if (accent && accent.trim()) {
    vars["--gold"] = accent.trim();
    vars["--gold-light"] = accent.trim();
    const soft = hexToRgba(accent, 0.1);
    const softBorder = hexToRgba(accent, 0.28);
    if (soft) vars["--gold-soft"] = soft;
    if (softBorder) vars["--gold-soft-border"] = softBorder;
  }
  return vars;
}
