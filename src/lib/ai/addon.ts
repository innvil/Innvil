/**
 * AI add-on state. Two independent AI features:
 *
 *  1. Owner → Innvil AI assistant (owners asking how to run their panel / reach
 *     Innvil support): FREE, always available, Innvil-funded. No flag needed.
 *
 *  2. Customer AI support chat on the storefront: a PAID per-panel add-on the owner
 *     buys ($2.99/mo from the panel's Innvil balance). Subscription state lives in
 *     panels.settings.addons.ai_support. This module reads that state.
 *
 * Pure/serializable — safe to import server-side anywhere; the active boolean is
 * passed to the client via props.
 */

import { planBundlesSupport } from "@/src/lib/plans";

export interface AiSupportSub {
  enabled: boolean;
  since: string | null;
  lastChargeAt: string | null;
  nextChargeAt: string | null;
  /** true when a scheduled charge failed for lack of balance (paused until funded). */
  lapsed: boolean;
}

export function readSupportSub(settings: unknown): AiSupportSub {
  const off: AiSupportSub = { enabled: false, since: null, lastChargeAt: null, nextChargeAt: null, lapsed: false };
  if (settings && typeof settings === "object") {
    const addons = (settings as Record<string, unknown>).addons;
    if (addons && typeof addons === "object") {
      const a = (addons as Record<string, unknown>).ai_support;
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        return {
          enabled: o.enabled === true,
          since: typeof o.since === "string" ? o.since : null,
          lastChargeAt: typeof o.lastChargeAt === "string" ? o.lastChargeAt : null,
          nextChargeAt: typeof o.nextChargeAt === "string" ? o.nextChargeAt : null,
          lapsed: o.lapsed === true,
        };
      }
    }
  }
  return off;
}

/**
 * Whether the storefront customer AI support chat is active for a panel — i.e. the
 * owner has the paid add-on enabled, a super admin comped it, OR the panel is on the
 * Business plan (which bundles it). Off by default.
 */
export function customerSupportActive(settings: unknown): boolean {
  return planBundlesSupport(settings) || readSupportSub(settings).enabled;
}
