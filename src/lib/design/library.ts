/**
 * Per-panel DESIGN LIBRARY — which marketplace designs a panel has bought (owned
 * forever) and which one is currently applied to its storefront landing.
 *
 * Stored in panels.settings.addons.design. Pure/serializable — safe anywhere.
 */

export interface DesignLibrary {
  /** Design ids bought for this panel. A purchase is permanent. */
  owned: string[];
  /** The design currently applied to the storefront landing (must be owned). */
  active: string | null;
}

const EMPTY: DesignLibrary = { owned: [], active: null };

export function readDesignLibrary(settings: unknown): DesignLibrary {
  if (!settings || typeof settings !== "object") return EMPTY;
  const addons = (settings as Record<string, unknown>).addons;
  if (!addons || typeof addons !== "object") return EMPTY;
  const d = (addons as Record<string, unknown>).design;
  if (!d || typeof d !== "object") return EMPTY;

  const o = d as Record<string, unknown>;
  const owned = Array.isArray(o.owned)
    ? Array.from(new Set(o.owned.filter((x): x is string => typeof x === "string" && x.length > 0)))
    : [];
  const rawActive = typeof o.active === "string" ? o.active : null;
  // An active design must still be owned — guards against tampering/stale state.
  const active = rawActive && owned.includes(rawActive) ? rawActive : null;
  return { owned, active };
}

export function ownsDesign(settings: unknown, designId: string): boolean {
  return readDesignLibrary(settings).owned.includes(designId);
}

/** The design applied to this panel's storefront landing, if any. */
export function activeDesignId(settings: unknown): string | null {
  return readDesignLibrary(settings).active;
}
