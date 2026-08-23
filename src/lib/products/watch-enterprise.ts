/**
 * Innvil Watch Enterprise — two commercial/provider MODES of the SAME
 * product (never separate products, domains, or CRMs — see CLAUDE.md).
 * Pure config/copy + pricing calculation only, no I/O.
 *
 * MANAGED  — Innvil supplies/manages the supported provider capacity.
 *            Pricing is a REAL, already-implemented formula
 *            (`moderatorEnterpriseSlotPrice`/`moderatorEnterpriseIncluded
 *            Communities` in money.ts, the same functions the Panel-side
 *            Enterprise sale already uses) — Platinum base + per-slot bands
 *            above it. Reused here verbatim, never a duplicated formula.
 *
 * BYO      — the customer supplies their own supported provider
 *            credentials; provider usage is billed directly through their
 *            own provider account, never through Innvil. Pricing is the
 *            explicit two-tier model, repriced 2026-08-22 (BYO 50 = $299/mo
 *            up to 50 licensed deployments, BYO Unlimited = $499/mo
 *            unlimited licensed deployments). There is still NO real BYO
 *            credentials-connection backend anywhere in this codebase --
 *            this module covers PRICING/COPY only, never a fake
 *            "Connect Provider" workflow. BYO NEVER receives an
 *            Innvil-funded AI Generation pool and must NEVER silently fall
 *            back to an Innvil-owned conversational credential -- the
 *            customer's own provider is the only credential ever used for a
 *            BYO account's conversational generation.
 *
 * As of 2026-08-22, Enterprise is headlined by three FIXED packages rather
 * than an open-ended per-slot calculation: Managed Enterprise 50 ($399/mo,
 * fixed), BYO Enterprise 50 ($299/mo, fixed), BYO Enterprise Unlimited
 * ($499/mo, fixed). The per-slot formula (moderatorEnterpriseSlotPrice)
 * remains available for a genuinely CUSTOM Managed quote ABOVE 50 slots --
 * it is no longer used to price the standard 50-slot Managed offering.
 */

import {
  moderatorEnterpriseIncludedCommunities, managedEnterprisePriceAtSlots, ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE,
  ENTERPRISE_MANAGED_50_PRICE, ENTERPRISE_MANAGED_50_SLOTS, ENTERPRISE_MANAGED_50_AI_GENERATIONS,
  ENTERPRISE_BYO_50_PRICE, ENTERPRISE_BYO_UNLIMITED_PRICE, ENTERPRISE_MEDIA_ADDON,
  type EnterpriseMediaAddonPricing,
} from "@/src/lib/money";
import {
  getEnterpriseCommunityExpansionPrice, getEnterpriseIncludedCommunities, type EnterpriseCommunityMode,
} from "./watch-enterprise-community";

export { ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE };
export type { EnterpriseCommunityMode };

export type EnterpriseMode = "managed" | "byo";

export interface EnterpriseModeMeta {
  mode: EnterpriseMode;
  label: string;
  tagline: string;
  /** Pre-filled subject for the existing sendOwnerSupportMessage inquiry
   *  channel -- the SAME channel every other Enterprise/support inquiry on
   *  this page already uses, never a second contact mechanism. */
  inquirySubject: string;
}

export const ENTERPRISE_MODES: Record<EnterpriseMode, EnterpriseModeMeta> = {
  managed: {
    mode: "managed",
    label: "Managed Enterprise",
    tagline: "Fully managed provider model",
    inquirySubject: "Innvil Watch Enterprise — Managed",
  },
  byo: {
    mode: "byo",
    label: "Bring Your Own Provider",
    tagline: "Your provider, same Watch CRM",
    inquirySubject: "Innvil Watch Enterprise — Bring Your Own Provider",
  },
};

/** The pre-filled inquiry body for a given Enterprise mode -- just the real
 *  usage context (current plan/slots/Communities) every Enterprise inquiry
 *  on this page already includes. Does NOT restate the mode label -- the
 *  inquiry's subject line (`ENTERPRISE_MODES[mode].inquirySubject`) already
 *  says "Innvil Watch Enterprise — Managed"/"...— Bring Your Own Provider",
 *  so repeating "Enterprise mode: X" as the first line of the body was pure
 *  redundancy (a live screenshot showed both lines back to back).
 *
 *  For Managed specifically, `managedSlots` (when given) appends the
 *  customer's ACTUAL configured slot count from ManagedEnterpriseCalculator
 *  plus its live-computed price/Community allowance -- computed via the
 *  SAME canonical `managedEnterprisePrice`/`managedEnterpriseCommunities`
 *  functions the calculator itself uses, never a duplicated formula. Closes
 *  the gap where the calculator's selection never reached the actual
 *  submitted inquiry (a real "configure something, submit something else"
 *  disconnect) -- the request now reflects exactly what was configured. */
export function buildEnterpriseInquiryBody(
  mode: EnterpriseMode,
  baseUsageContext: string,
  managedSlots?: number,
  mediaAddonKey?: "managed50" | "byo50" | "byoUnlimited",
  /** The selected Community capacity PACKAGE (never the base/included
   *  state, which needs no line here) -- keyed to the SAME
   *  EnterpriseCommunityMode the canonical watch-enterprise-community.ts
   *  helpers use, so this can never drift from the price actually shown in
   *  the selector UI. */
  communityCapacity?: { communityMode: EnterpriseCommunityMode; capacity: number },
): string {
  const mediaLine = mediaAddonKey
    ? `Requested add-on: Media Moderation + (+$${ENTERPRISE_MEDIA_ADDON[mediaAddonKey].price.toFixed(2)}/mo, ${ENTERPRISE_MEDIA_ADDON[mediaAddonKey].units.toLocaleString()} Media Moderation Units/mo).\n\n`
    : "";
  const communityLine = (() => {
    if (!communityCapacity) return "";
    const { communityMode, capacity } = communityCapacity;
    if (capacity === getEnterpriseIncludedCommunities(communityMode)) return "";
    const price = getEnterpriseCommunityExpansionPrice(communityMode, capacity);
    if (price == null) return "";
    return `Requested Community Expansion: up to ${capacity} Communities (+$${price.toFixed(2)}/mo).\n\n`;
  })();
  if (mode !== "managed") return `${mediaLine}${communityLine}${baseUsageContext}`;
  if (managedSlots && managedSlots > MANAGED_ENTERPRISE_50.slots) {
    const price = managedEnterprisePrice(managedSlots);
    const communities = managedEnterpriseCommunities(managedSlots);
    const configuredLine = `Requested Managed Enterprise capacity: ${managedSlots} Watcher slots -- $${price.toFixed(2)}/mo (canonical price: $${MANAGED_ENTERPRISE_50.price.toFixed(2)} base + $${ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE}/slot above ${MANAGED_ENTERPRISE_50.slots}), ${communities} Communities included. Provisioning is completed with Innvil support.`;
    return `${configuredLine}\n\n${mediaLine}${communityLine}${baseUsageContext}`;
  }
  const fixed = MANAGED_ENTERPRISE_50;
  const configuredLine = `Requested Managed Enterprise 50: ${fixed.slots} Watcher slots, $${fixed.price.toFixed(2)}/mo, ${fixed.communities} Communities included, ${fixed.aiGenerations.toLocaleString()} pooled AI Generations/mo.`;
  return `${configuredLine}\n\n${mediaLine}${communityLine}${baseUsageContext}`;
}

/** Managed Enterprise price at ANY Watcher slot count -- the ONE canonical
 *  helper every Managed pricing surface (calculator, comparison, inquiry
 *  summary) must call, never a duplicated `$8`/`$399` literal. Thin
 *  passthrough to money.ts's `managedEnterprisePriceAtSlots` (the real,
 *  deterministic $399 + $8/slot-above-50 rule, 2026-08-22 correction --
 *  supersedes the old Platinum-based per-slot formula, which is no longer
 *  used for Managed pricing at all). */
export function managedEnterprisePrice(slots: number): number {
  return managedEnterprisePriceAtSlots(slots);
}

/** Managed Enterprise's Community count at ANY slot count -- ALWAYS the
 *  fixed Managed Enterprise 50 base count (8). Additional Watcher slots
 *  above 50 do NOT automatically grant additional Community capacity --
 *  that's governed entirely by the separate Community Expansion add-on
 *  (queued, not yet built as a purchasable Enterprise entitlement), never
 *  by slot count. Deliberately does NOT call the old
 *  `moderatorEnterpriseIncludedCommunities` slot-scaling formula, which
 *  incorrectly implied more slots meant more Communities. */
export function managedEnterpriseCommunities(_slots: number): number {
  return MANAGED_ENTERPRISE_50.communities;
}

/** The fixed, headline Managed Enterprise package (2026-08-22 repricing) --
 *  $399/mo for 50 Watcher slots and a 50,000/mo pooled (account-wide, never
 *  per-Watcher) AI Generation allowance. Community count is still read from
 *  the existing canonical formula at exactly 50 slots -- that axis wasn't
 *  repriced, only the headline dollar figure and the AI Generation pool
 *  size were. */
export const MANAGED_ENTERPRISE_50 = {
  price: ENTERPRISE_MANAGED_50_PRICE,
  slots: ENTERPRISE_MANAGED_50_SLOTS,
  aiGenerations: ENTERPRISE_MANAGED_50_AI_GENERATIONS,
  communities: moderatorEnterpriseIncludedCommunities(ENTERPRISE_MANAGED_50_SLOTS),
};

/** BYO Enterprise's two fixed commercial tiers -- NOT a per-slot formula
 *  (unlike a custom Managed quote). "50" and "Unlimited" remain the only two
 *  BYO price points this codebase records; repriced 2026-08-22
 *  ($599->$299, $799->$499). BYO never carries an AI Generation allowance --
 *  the customer's own provider pays for and produces every generation. */
export interface WatchByoTier {
  id: "byo_50" | "byo_unlimited";
  label: string;
  maxSlots: number | null; // null = unlimited
  price: number;
}
export const WATCH_ENTERPRISE_BYO_TIERS: WatchByoTier[] = [
  { id: "byo_50", label: "BYO 50", maxSlots: 50, price: ENTERPRISE_BYO_50_PRICE },
  { id: "byo_unlimited", label: "BYO Unlimited", maxSlots: null, price: ENTERPRISE_BYO_UNLIMITED_PRICE },
];

/** Optional Media Moderation + add-on for a given Enterprise package --
 *  layered on top of the base price, never bundled into it. Provider-
 *  neutral Media Moderation Units (never Sightengine-specific terminology).
 *  `null` for a slot count with no matching fixed package (no invented
 *  pricing for a custom Managed quote's add-on -- not defined anywhere). */
export function enterpriseMediaAddon(key: "managed50" | "byo50" | "byoUnlimited"): EnterpriseMediaAddonPricing {
  return ENTERPRISE_MEDIA_ADDON[key];
}

/** Total monthly price for a fixed Enterprise package with Media
 *  Moderation + enabled -- plain addition, rounded to 2dp to avoid
 *  floating-point display drift (e.g. 399 + 39.99 must read $438.99, not
 *  $438.99000000000004). */
export function enterprisePackageTotalWithMedia(basePrice: number, addonKey: "managed50" | "byo50" | "byoUnlimited"): number {
  return Math.round((basePrice + ENTERPRISE_MEDIA_ADDON[addonKey].price) * 100) / 100;
}

export interface EnterpriseSavingsComparison {
  slots: number;
  managedPrice: number;
  byoPrice: number;
  savingsAmount: number;
  savingsPercent: number;
}

/** A real, equivalent-capacity Innvil-fee comparison — ONLY valid at the
 *  exact slot count a BYO tier actually covers (BYO 50 vs. Managed AT 50
 *  slots), never a mismatched comparison (e.g. BYO Unlimited has no Managed
 *  equivalent, since Managed has no "unlimited" concept -- it keeps scaling
 *  per slot indefinitely -- so no savings figure is computed for that tier;
 *  callers should present it as its own tier, not a comparison). Rounded to
 *  2dp for the dollar amount and 1dp for the percentage, matching how this
 *  codebase already formats money/percentages elsewhere. */
export function compareEnterpriseModesAtSlots(slots: number): EnterpriseSavingsComparison | null {
  const tier = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.maxSlots === slots);
  if (!tier) return null;
  // managedEnterprisePrice already resolves the exact fixed $399 at 50
  // slots (its own <=50 branch), so no special-casing is needed here.
  const managedPrice = managedEnterprisePrice(slots);
  const byoPrice = tier.price;
  const savingsAmount = Math.round((managedPrice - byoPrice) * 100) / 100;
  const savingsPercent = Math.round((savingsAmount / managedPrice) * 1000) / 10;
  return { slots, managedPrice, byoPrice, savingsAmount, savingsPercent };
}
