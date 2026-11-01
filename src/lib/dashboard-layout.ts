/**
 * Customer-dashboard HOME layout (Design Tools). Lets a Business owner rearrange
 * and show/hide the home widgets with built-in controls — NO custom code, and the
 * backend/order/wallet logic is never touched. Config lives in
 * panels.settings.dashboard.home. When unset, the storefront renders the default
 * layout unchanged. Pure/serializable.
 */

export type DashboardWidgetId = "stats" | "favorites" | "recent" | "orders";

export interface DashboardWidget {
  id: DashboardWidgetId;
  visible: boolean;
}

export const DASHBOARD_WIDGET_LABELS: Record<DashboardWidgetId, string> = {
  stats: "Stats overview",
  favorites: "Favorites · quick order",
  recent: "Recently ordered",
  orders: "Recent orders",
};

/** Canonical order + all-visible default. */
export const DEFAULT_DASHBOARD_HOME: DashboardWidget[] = [
  { id: "stats", visible: true },
  { id: "favorites", visible: true },
  { id: "recent", visible: true },
  { id: "orders", visible: true },
];

const VALID_IDS: DashboardWidgetId[] = ["stats", "favorites", "recent", "orders"];

/**
 * Read a saved home layout, or null if none is configured (→ render the default).
 * Coerces/repairs: dedupes, drops unknown ids, and appends any missing widgets
 * (hidden) so the set is always complete even after we add new widgets.
 */
export function readDashboardHome(settings: unknown): DashboardWidget[] | null {
  if (!settings || typeof settings !== "object") return null;
  const dash = (settings as Record<string, unknown>).dashboard;
  if (!dash || typeof dash !== "object") return null;
  const raw = (dash as Record<string, unknown>).home;
  if (!Array.isArray(raw)) return null;

  const seen = new Set<DashboardWidgetId>();
  const out: DashboardWidget[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = (item as Record<string, unknown>).id as DashboardWidgetId;
    if (!VALID_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, visible: (item as Record<string, unknown>).visible !== false });
  }
  if (out.length === 0) return null;
  // Append any widgets missing from the saved config (default visible), so a
  // customized panel still shows newly-added widgets.
  for (const id of VALID_IDS) if (!seen.has(id)) out.push({ id, visible: true });
  return out;
}

/** Normalize an arbitrary layout to a clean, complete widget list (for saving). */
export function normalizeDashboardHome(layout: DashboardWidget[]): DashboardWidget[] {
  const seen = new Set<DashboardWidgetId>();
  const out: DashboardWidget[] = [];
  for (const w of layout ?? []) {
    if (!w || !VALID_IDS.includes(w.id) || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ id: w.id, visible: w.visible !== false });
  }
  for (const id of VALID_IDS) if (!seen.has(id)) out.push({ id, visible: true });
  return out;
}
