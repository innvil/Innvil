/**
 * Innvil Virtual Moderator — panel-level add-on subscription + capability
 * entitlements. Mirrors src/lib/plans.ts (Campaign Automation): pure
 * readX/hasX functions over panels.settings.addons.moderator, no new
 * billing/entitlement engine. Runtime code must call these capability
 * checks (virtual_mod.*) instead of branching on tier name or commercial
 * mode directly (spec §3/§4 — monetization establishes entitlement; the
 * runtime only reads capability flags).
 *
 * Two independent axes, both approved (§3):
 *   - commercialMode: "commission" (Innvil sells to the end customer, owner
 *     gets MODERATOR_COMMISSION_SHARE) or "rental" (owner buys capacity at
 *     MODERATOR_RENTAL_DISCOUNT below list price and re-sells at their own
 *     price). Purely a billing/revenue-split concern.
 *   - tier: basic/standard/premium/pro — decides ACTIVE MOD SLOT + community
 *     capacity and which capabilities (proactive mode, community memory) are
 *     unlocked. Capacity is unrelated to commercialMode.
 */

import type { ModeratorPlanTier } from "@/src/lib/money";

export type { ModeratorPlanTier };
export type ModeratorCommercialMode = "commission" | "rental";

const TIERS: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro"];
const MODES: ModeratorCommercialMode[] = ["commission", "rental"];

export interface ModeratorAddonSub {
  tier: ModeratorPlanTier | null;
  commercialMode: ModeratorCommercialMode;
  since: string | null;
  lastChargeAt: string | null;
  nextChargeAt: string | null;
  /** true when a scheduled charge failed for lack of balance (paused until funded). Only meaningful for rental. */
  lapsed: boolean;
}

const OFF: ModeratorAddonSub = {
  tier: null,
  commercialMode: "commission",
  since: null,
  lastChargeAt: null,
  nextChargeAt: null,
  lapsed: false,
};

export function readModeratorAddon(settings: unknown): ModeratorAddonSub {
  if (settings && typeof settings === "object") {
    const addons = (settings as Record<string, unknown>).addons;
    if (addons && typeof addons === "object") {
      const raw = (addons as Record<string, unknown>).moderator;
      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const tier = TIERS.includes(o.tier as ModeratorPlanTier) ? (o.tier as ModeratorPlanTier) : null;
        const commercialMode = MODES.includes(o.commercialMode as ModeratorCommercialMode)
          ? (o.commercialMode as ModeratorCommercialMode)
          : "commission";
        return {
          tier,
          commercialMode,
          since: typeof o.since === "string" ? o.since : null,
          lastChargeAt: typeof o.lastChargeAt === "string" ? o.lastChargeAt : null,
          nextChargeAt: typeof o.nextChargeAt === "string" ? o.nextChargeAt : null,
          lapsed: o.lapsed === true,
        };
      }
    }
  }
  return { ...OFF };
}

export function moderatorTier(settings: unknown): ModeratorPlanTier | null {
  return readModeratorAddon(settings).tier;
}

/** True when this panel has ANY active Virtual Moderator tier (offered to its customers/usable by the owner). */
export function hasVirtualModerator(settings: unknown): boolean {
  return moderatorTier(settings) !== null;
}

/* ------------------------------------------------------------- capacity ---- */

export interface ModeratorCapacity {
  maxCommunities: number;
  maxActiveSlots: number;
}

const CAPACITY: Record<ModeratorPlanTier, ModeratorCapacity> = {
  basic: { maxCommunities: 1, maxActiveSlots: 2 },
  standard: { maxCommunities: 2, maxActiveSlots: 6 },
  premium: { maxCommunities: 3, maxActiveSlots: 12 },
  pro: { maxCommunities: 5, maxActiveSlots: 20 },
};

/** Active Mod Slot / community capacity for the panel's current tier (zero if not subscribed). */
export function moderatorCapacity(settings: unknown): ModeratorCapacity {
  const tier = moderatorTier(settings);
  return tier ? CAPACITY[tier] : { maxCommunities: 0, maxActiveSlots: 0 };
}

/* ---------------------------------------------------------- capabilities ---- */
// Runtime code asks these, never `if (tier === "standard")` directly.

/** Reactive natural chatter — available on any active tier (Basic+, §15). */
export function virtualModNaturalChatter(settings: unknown): boolean {
  return hasVirtualModerator(settings);
}

/** Proactive Mode (GM/GN, dead-chat revival, conversation starters) — Standard+ only (§15). */
export function virtualModProactiveMode(settings: unknown): boolean {
  const tier = moderatorTier(settings);
  return tier === "standard" || tier === "premium" || tier === "pro";
}

/** Long-term Community Memory — Standard+ only (§18). */
export function virtualModCommunityMemory(settings: unknown): boolean {
  return virtualModProactiveMode(settings);
}

/** Full custom personality (beyond presets) — Standard+ only (§15). */
export function virtualModCustomPersonality(settings: unknown): boolean {
  return virtualModProactiveMode(settings);
}

/** Moderation capability — available on any active tier (basic moderation included, §3/§27 of PDF). */
export function virtualModModeration(settings: unknown): boolean {
  return hasVirtualModerator(settings);
}
