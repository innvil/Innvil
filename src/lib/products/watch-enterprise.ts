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
 *            explicit two-tier model previously recorded in CLAUDE.md's
 *            "Phase 4.S — Future Enterprise BYO pricing" planning note
 *            (BYO 50 = $599/mo up to 50 licensed deployments, BYO Unlimited
 *            = $799/mo) — promoted from planning note to live Billing copy
 *            as an explicit business decision this pass (see the dated
 *            changelog entry). There is still NO real BYO credentials-
 *            connection backend anywhere in this codebase -- this module
 *            covers PRICING/COPY only, never a fake "Connect Provider"
 *            workflow.
 */

import { moderatorEnterpriseSlotPrice, moderatorEnterpriseIncludedCommunities } from "@/src/lib/money";

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
export function buildEnterpriseInquiryBody(mode: EnterpriseMode, baseUsageContext: string, managedSlots?: number): string {
  if (mode !== "managed" || !managedSlots || managedSlots < 1) return baseUsageContext;
  const price = managedEnterprisePrice(managedSlots);
  const communities = managedEnterpriseCommunities(managedSlots);
  const configuredLine = `Requested Managed Enterprise capacity: ${managedSlots} Watcher slots (~$${price.toFixed(2)}/mo, ${communities} Communities included).`;
  return `${configuredLine}\n\n${baseUsageContext}`;
}

/** Managed Enterprise price at a given Watcher slot count -- a thin,
 *  Watch-flavored wrapper around the REAL canonical formula in money.ts
 *  (Platinum/Pro base + per-slot bands), never a duplicated calculation. */
export function managedEnterprisePrice(slots: number): number {
  return moderatorEnterpriseSlotPrice(slots);
}

/** Managed Enterprise's real, deterministic included-Community count at a
 *  given slot count -- also a direct passthrough to money.ts, never
 *  invented. Community capacity for BYO is NOT modeled by this formula (no
 *  canonical BYO Community rule is recorded anywhere) -- BYO stays "custom"
 *  in the UI rather than borrowing this number. */
export function managedEnterpriseCommunities(slots: number): number {
  return moderatorEnterpriseIncludedCommunities(slots);
}

/** BYO Enterprise's two fixed commercial tiers -- NOT a per-slot formula
 *  (unlike Managed). "50" and "Unlimited" are the only two BYO price points
 *  this codebase has ever recorded (Phase 4.S). */
export interface WatchByoTier {
  id: "byo_50" | "byo_unlimited";
  label: string;
  maxSlots: number | null; // null = unlimited
  price: number;
}
export const WATCH_ENTERPRISE_BYO_TIERS: WatchByoTier[] = [
  { id: "byo_50", label: "BYO 50", maxSlots: 50, price: 599 },
  { id: "byo_unlimited", label: "BYO Unlimited", maxSlots: null, price: 799 },
];

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
  const managedPrice = managedEnterprisePrice(slots);
  const byoPrice = tier.price;
  const savingsAmount = Math.round((managedPrice - byoPrice) * 100) / 100;
  const savingsPercent = Math.round((savingsAmount / managedPrice) * 1000) / 10;
  return { slots, managedPrice, byoPrice, savingsAmount, savingsPercent };
}
