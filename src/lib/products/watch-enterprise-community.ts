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

const BYO50_BASE = 10;
const BYO50_PACKAGES: EnterpriseCommunityPackageOption[] = [
  { capacity: 15, price: 12.99 },
  { capacity: 25, price: 19.99 },
];

const BYO_UNLIMITED_BASE = 10;
const BYO_UNLIMITED_PACKAGES: EnterpriseCommunityPackageOption[] = [
  { capacity: 15, price: 12.99 },
  { capacity: 25, price: 19.99 },
];
/** Beyond the 25-capacity package, BYO Unlimited has NO plan-level ceiling --
 *  every additional +10-Community block is a flat, cumulative price, derived
 *  from the incremental cost between the 15 and 25 packages (19.99 - 12.99 =
 *  7.00), discounted 30% at scale: 7.00 * 0.70 = 4.90/block. This is the
 *  ONLY canonical self-serve-style overage rate that exists anywhere in this
 *  codebase -- it applies ONLY to BYO Unlimited beyond 25, never invented
 *  for Managed or BYO 50 (both have a real hard maximum at 25). */
export const BYO_UNLIMITED_BLOCK_SIZE = 10;
export const BYO_UNLIMITED_BLOCK_PRICE = 4.9;
const BYO_UNLIMITED_MAX_PACKAGED_CAPACITY = 25;

/** The base (no add-on) included Community capacity for a mode -- what the
 *  fixed Enterprise package itself already includes before any expansion. */
export function getEnterpriseIncludedCommunities(mode: EnterpriseCommunityMode): number {
  if (mode === "managed") return MANAGED_BASE;
  return mode === "byo50" ? BYO50_BASE : BYO_UNLIMITED_BASE;
}

/** The selectable expansion packages for a mode, in ascending capacity
 *  order -- NOT including the base (unexpanded) state, which callers should
 *  represent separately (e.g. "Included" vs. these paid options). For BYO
 *  Unlimited, this returns only the two fixed packages (15/25); +10 blocks
 *  beyond 25 are a continuous, uncapped continuation handled separately by
 *  `getEnterpriseCommunityExpansionPrice`/`nextByoUnlimitedBlockCapacity`,
 *  never enumerated as a finite list (there is no ceiling to enumerate to). */
export function getEnterpriseCommunityExpansionOptions(mode: EnterpriseCommunityMode): EnterpriseCommunityPackageOption[] {
  if (mode === "managed") return MANAGED_PACKAGES;
  return mode === "byo50" ? BYO50_PACKAGES : BYO_UNLIMITED_PACKAGES;
}

/** The real, absolute maximum Community capacity for a mode via THIS
 *  package model -- Managed and BYO 50 both hard-cap at 25 (no path beyond
 *  it exists in this model); BYO Unlimited has none (returns null). */
export function getEnterpriseCommunityHardMax(mode: EnterpriseCommunityMode): number | null {
  return mode === "byoUnlimited" ? null : 25;
}

/** Whether a requested TOTAL capacity is a real, purchasable state for a
 *  mode -- the base, one of the mode's fixed packages, or (BYO Unlimited
 *  only) a valid 25 + N*10 block continuation. Never trusts a client-
 *  submitted capacity value without this check -- the canonical server-side
 *  gate every admin/devops provisioning path and any future purchase path
 *  must call before persisting a requested capacity. */
export function validateEnterpriseCommunityCapacity(mode: EnterpriseCommunityMode, capacity: number): boolean {
  if (!Number.isInteger(capacity) || capacity < getEnterpriseIncludedCommunities(mode)) return false;
  if (capacity === getEnterpriseIncludedCommunities(mode)) return true;
  const packaged = getEnterpriseCommunityExpansionOptions(mode).some((o) => o.capacity === capacity);
  if (packaged) return true;
  if (mode === "byoUnlimited" && capacity > BYO_UNLIMITED_MAX_PACKAGED_CAPACITY) {
    const extra = capacity - BYO_UNLIMITED_MAX_PACKAGED_CAPACITY;
    return extra % BYO_UNLIMITED_BLOCK_SIZE === 0;
  }
  return false;
}

/** The real total monthly expansion price for a mode at a given TOTAL
 *  capacity -- $0 at the base (included) capacity, the matching fixed
 *  package's own price for a packaged capacity, or (BYO Unlimited only)
 *  19.99 + (blocksAbove25 * 4.90) for a valid capacity beyond 25. Packages
 *  are NEVER additive -- this returns the ONE price for the SELECTED total
 *  capacity, never a sum of every package up to it. Returns null for an
 *  invalid/unsupported capacity (never fabricates a price for one) --
 *  callers should check `validateEnterpriseCommunityCapacity` first, or
 *  treat a null return the same way. */
export function getEnterpriseCommunityExpansionPrice(mode: EnterpriseCommunityMode, capacity: number): number | null {
  if (!validateEnterpriseCommunityCapacity(mode, capacity)) return null;
  const included = getEnterpriseIncludedCommunities(mode);
  if (capacity === included) return 0;
  const packaged = getEnterpriseCommunityExpansionOptions(mode).find((o) => o.capacity === capacity);
  if (packaged) return packaged.price;
  // Only reachable for BYO Unlimited beyond 25 (validated above).
  const blocksAbove25 = (capacity - BYO_UNLIMITED_MAX_PACKAGED_CAPACITY) / BYO_UNLIMITED_BLOCK_SIZE;
  const base25 = BYO_UNLIMITED_PACKAGES.find((o) => o.capacity === BYO_UNLIMITED_MAX_PACKAGED_CAPACITY)!.price;
  return Math.round((base25 + blocksAbove25 * BYO_UNLIMITED_BLOCK_PRICE) * 100) / 100;
}

/** BYO Unlimited only -- the next valid +10-Community capacity step above a
 *  given current capacity (used to drive a simple "Add 10 Communities"
 *  control rather than enumerating an infinite option list). Returns the
 *  first real package (15) if starting from the base, otherwise the next
 *  package/block in sequence. */
export function nextByoUnlimitedCapacityStep(currentCapacity: number): number {
  if (currentCapacity < 15) return 15;
  if (currentCapacity < 25) return 25;
  return currentCapacity + BYO_UNLIMITED_BLOCK_SIZE;
}
