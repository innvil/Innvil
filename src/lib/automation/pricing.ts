/**
 * Customer-facing Automator subscription PRICING — per panel, owner-configurable.
 *
 * The 6.99 / 9.99 figures are only SUGGESTED DEFAULTS. Owners can override the monthly
 * price and run a promo/discount. State lives in panels.settings.automator. Pure and
 * serializable — safe on the client or server.
 *
 * The feature SET the subscription unlocks follows the OWNER's tier (see plans.ts):
 *   - Pro / Business  → keyword automation (default $6.99/mo)
 *   - Business+       → + file upload + watched accounts (default $9.99/mo)
 */

import { planTier } from "@/src/lib/plans";
import { round4 } from "@/src/lib/money";

/** Default suggested monthly price — standard tiers (Pro / Business owner). */
export const SUGGESTED_AUTOMATOR_PRICE = 6.99;
/** Default suggested monthly price — Business+ (adds file upload + watched accounts). */
export const SUGGESTED_AUTOMATOR_PLUS_PRICE = 9.99;

export interface AutomatorPricing {
  /** Owner override of the monthly price. null = use the tier's suggested default. */
  price: number | null;
  promoActive: boolean;
  /** Promotional monthly price while promoActive (must be below the base to apply). */
  promoPrice: number | null;
  /** Short label shown next to the promo, e.g. "Launch offer". */
  promoLabel: string | null;
}

const DEFAULT: AutomatorPricing = { price: null, promoActive: false, promoPrice: null, promoLabel: null };

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round4(n) : null;
}

export function readAutomatorPricing(settings: unknown): AutomatorPricing {
  if (settings && typeof settings === "object") {
    const a = (settings as Record<string, unknown>).automator;
    if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      return {
        price: num(o.price),
        promoActive: o.promoActive === true,
        promoPrice: num(o.promoPrice),
        promoLabel: typeof o.promoLabel === "string" && o.promoLabel.trim() ? o.promoLabel.trim().slice(0, 40) : null,
      };
    }
  }
  return { ...DEFAULT };
}

/** The suggested default for this panel's tier (Business+ → the higher plus price). */
export function suggestedAutomatorPrice(settings: unknown): number {
  return planTier(settings) === "business_plus" ? SUGGESTED_AUTOMATOR_PLUS_PRICE : SUGGESTED_AUTOMATOR_PRICE;
}

/** The non-promo monthly price (owner override, else the tier's suggested default). */
export function baseAutomatorPrice(settings: unknown): number {
  const p = readAutomatorPricing(settings);
  return round4(p.price != null ? p.price : suggestedAutomatorPrice(settings));
}

/** What the customer actually pays now: a valid active promo, else the base price. */
export function effectiveAutomatorPrice(settings: unknown): number {
  const p = readAutomatorPricing(settings);
  const base = baseAutomatorPrice(settings);
  if (p.promoActive && p.promoPrice != null && p.promoPrice < base) return round4(p.promoPrice);
  return base;
}

/** True when an active promo is actually discounting the base price. */
export function automatorPromoApplies(settings: unknown): boolean {
  const p = readAutomatorPricing(settings);
  return p.promoActive && p.promoPrice != null && p.promoPrice < baseAutomatorPrice(settings);
}

/** Clamp/sanitize owner-supplied pricing before persisting. */
export function normalizeAutomatorPricing(input: Partial<AutomatorPricing>): AutomatorPricing {
  return {
    price: num(input.price),
    promoActive: input.promoActive === true,
    promoPrice: num(input.promoPrice),
    promoLabel:
      typeof input.promoLabel === "string" && input.promoLabel.trim() ? input.promoLabel.trim().slice(0, 40) : null,
  };
}
