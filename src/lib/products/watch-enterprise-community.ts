/**
 * Enterprise Community Expansion -- a SEPARATE commercial resource from
 * Watcher slots/AI Generations/Media Moderation Units/storage/bandwidth/
 * Auto-Posting (2026-08-22). Purchasing more Community capacity never
 * grants more of any of those; extra Watcher slots above a package's base
 * never grant more Community capacity either (see watch-enterprise.ts's
 * managedEnterpriseCommunities, which already enforces this for slots).
 *
 * Pure config/pricing module, no I/O -- the ONE canonical source every
 * Enterprise Community capacity surface (UI selectors, inquiry copy, the
 * entitlement resolver, admin/devops provisioning) must read from, so
 * `if (mode === "managed") ... else if (mode === "byo50") ...` branching
 * never gets scattered across components.
 *
 * These are FIXED CAPACITY PACKAGES, never per-Community pricing -- e.g.
 * Managed's "+$9.99 -> 10 total" is one flat package, not $9.99/Community.
 * Packages within a mode are NOT additive/cumulative -- selecting the
 * 25-Community package for Managed costs $24.99 total (not $9.99+$14.99+
 * $24.99); only the highest selected package's price applies.
 *
 * Self-service purchase/checkout for THIS resource does not exist for any
 * Enterprise mode yet (Enterprise itself remains inquiry/manual-provisioning
 * -- see watch-enterprise.ts's own doc comment). This module is the real,
 * canonical pricing/config layer everything else (UI, inquiry copy, the
 * entitlement resolver once support manually grants a package, admin/devops
 * provisioning) is meant to build on, per explicit product instruction not
 * to build a fake checkout system solely to represent this data.
 */

export type EnterpriseCommunityMode = "managed" | "byo50" | "byoUnlimited";

/** The ONE canonical (apiSourceMode, slots) -> EnterpriseCommunityMode
 *  mapping -- every surface that needs to know which Community-capacity
 *  package table applies to a given account/grant (the devops grant UI, the
 *  devops grant action's own validation, the entitlement-write layer in
 *  ownership.ts, and resolveEnterpriseMediaAddonKey's equivalent mapping in
 *  watch-enterprise.ts for the media add-on) must call THIS function, never
 *  redefine the mapping inline -- three independent inline copies of this
 *  exact three-line ternary is what let a real bug (the devops tool
 *  validating/persisting every mode's Community capacity against Managed's
 *  own rules) slip through review once already, 2026-08-25. `slots === null`
 *  means BYO Unlimited (Managed has no "Unlimited" package -- callers must
 *  never pass `apiSourceMode: "managed"` together with `slots: null`). */
export function communityModeFor(apiSourceMode: "managed" | "byo", slots: number | null): EnterpriseCommunityMode {
  if (apiSourceMode === "managed") return "managed";
  return slots === null ? "byoUnlimited" : "byo50";
}

export interface EnterpriseCommunityPackageOption {
  /** The resulting TOTAL Community capacity if this package is selected. */
  capacity: number;
  /** The flat monthly price for this package (never per-Community). */
  price: number;
}

const MANAGED_BASE = 8;
const MANAGED_PACKAGES: EnterpriseCommunityPackageOption[] = [
  { capacity: 10, price: 9.99 },
  { capacity: 15, price: 14.99 },
  { capacity: 25, price: 24.99 },
];

/**
 * REVISED (business decision, 2026-08-28): BYO literally means the customer
 * brings their own infrastructure/provider -- Innvil incurs no additional
 * marginal cost when a BYO customer connects more Communities the way it
 * does for a Managed account (which Innvil's own provider capacity has to
 * cover), so there is NO paid Community Expansion path for either BYO
 * Enterprise variant anymore. Only Managed Enterprise still has one.
 *
 * BYO 50 includes its real hard maximum (25 -- unchanged from before, see
 * `getEnterpriseCommunityHardMax`) as the base, for free, from day one --
 * nothing to buy, nothing above it to reach.
 *
 * BYO Unlimited includes literally UNLIMITED Communities, for free, from
 * day one -- represented the exact same way BYO Unlimited's own Watcher-
 * slot ceiling already is elsewhere in this codebase (a real
 * `Number.POSITIVE_INFINITY` sentinel, never a stored/fabricated finite
 * cap -- see `resolveAccountEnterpriseEntitlement`'s `slots: null` handling
 * in watch-runtime.ts). This is a genuine, honest "no limit", not a large
 * finite number standing in for one.
 */
const BYO50_BASE = 25;
const BYO_UNLIMITED_BASE = Number.POSITIVE_INFINITY;

/** The base (no add-on) included Community capacity for a mode -- what the
 *  fixed Enterprise package itself already includes before any expansion.
 *  Callers rendering this value to a customer/admin MUST use
 *  `formatSlotLimit` (or an equivalent finite-check) rather than
 *  interpolating it directly -- `Infinity` is a real, intentional return
 *  value for `"byoUnlimited"`, never a number to display or persist as-is. */
export function getEnterpriseIncludedCommunities(mode: EnterpriseCommunityMode): number {
  if (mode === "managed") return MANAGED_BASE;
  return mode === "byo50" ? BYO50_BASE : BYO_UNLIMITED_BASE;
}

/** The selectable PAID expansion packages for a mode -- empty for BOTH BYO
 *  variants (nothing to buy, per the module's own doc comment above); only
 *  Managed Enterprise still has real, purchasable packages. */
export function getEnterpriseCommunityExpansionOptions(mode: EnterpriseCommunityMode): EnterpriseCommunityPackageOption[] {
  return mode === "managed" ? MANAGED_PACKAGES : [];
}

/** The real, absolute maximum Community capacity for a mode -- Managed and
 *  BYO 50 both hard-cap at 25 (BYO 50's cap is now also its free, included
 *  base -- see above); BYO Unlimited has none (returns null, matching its
 *  `Infinity` included value). */
export function getEnterpriseCommunityHardMax(mode: EnterpriseCommunityMode): number | null {
  return mode === "byoUnlimited" ? null : 25;
}

/** Whether a requested TOTAL capacity is a real, valid state for a mode.
 *  The mode's own free/included base is ALWAYS valid (this is the only
 *  valid state at all for either BYO variant now, since neither has a paid
 *  expansion path anymore); for Managed, one of the real fixed packages
 *  above the base is also valid. Never trusts a client-submitted capacity
 *  value without this check -- the canonical server-side gate every admin/
 *  devops provisioning path must call before persisting a requested
 *  capacity. */
export function validateEnterpriseCommunityCapacity(mode: EnterpriseCommunityMode, capacity: number): boolean {
  const included = getEnterpriseIncludedCommunities(mode);
  if (capacity === included) return true;
  if (mode !== "managed") return false; // BYO has no paid expansion above its free base at all
  if (!Number.isInteger(capacity) || capacity < included) return false;
  return getEnterpriseCommunityExpansionOptions(mode).some((o) => o.capacity === capacity);
}

/** The real total monthly expansion price for a mode at a given TOTAL
 *  capacity -- always $0 at the mode's own included capacity (the only
 *  valid state for a BYO mode), or the matching fixed Managed package's own
 *  price. Packages are NEVER additive -- this returns the ONE price for the
 *  SELECTED total capacity, never a sum of every package up to it. Returns
 *  null for an invalid/unsupported capacity (never fabricates a price for
 *  one) -- callers should check `validateEnterpriseCommunityCapacity` first,
 *  or treat a null return the same way. */
export function getEnterpriseCommunityExpansionPrice(mode: EnterpriseCommunityMode, capacity: number): number | null {
  if (!validateEnterpriseCommunityCapacity(mode, capacity)) return null;
  const included = getEnterpriseIncludedCommunities(mode);
  if (capacity === included) return 0;
  const packaged = getEnterpriseCommunityExpansionOptions(mode).find((o) => o.capacity === capacity);
  return packaged ? packaged.price : null;
}
