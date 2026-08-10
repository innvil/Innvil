import type { MarkupKind } from "@/src/types/db";

/** 4-dp rounding to match the DB numeric(12,4) columns. */
export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** Innvil's default platform commission on completed-order revenue (5%, no monthly rent). */
export const INNVIL_COMMISSION_RATE = 0.05;
/** Lowest commission rate a high-volume panel can be discounted to (1%). */
export const INNVIL_MIN_COMMISSION_RATE = 0.01;
/** Hard cap on commission Innvil takes from ONE panel in a single day. Mirror of the SQL (0020). */
export const INNVIL_COMMISSION_CAP_PER_DAY = 100;

/** Monthly price (USD, from the panel's Innvil balance) of the optional CUSTOMER AI
 *  SUPPORT add-on — the owner pays to give their storefront customers AI support.
 *  The owner's own assistant (contacting Innvil) is free. Panel core stays 0% rent. */
export const AI_ADDON_PRICE = 2.99;
/** Billing period length for the paid AI add-on. */
export const AI_ADDON_PERIOD_DAYS = 30;

/** Campaign Automation subscription tiers (monthly, USD, from the panel's Innvil
 *  balance). Business bundles the AI support add-on. Panel core stays 0% rent. */
export const INNVIL_PRO_PRICE = 9.99;
export const INNVIL_BUSINESS_PRICE = 19.99;
export const INNVIL_BUSINESS_PLUS_PRICE = 49.99;
export const PLAN_PERIOD_DAYS = 30;
export function planPrice(tier: "pro" | "business" | "business_plus"): number {
  if (tier === "business_plus") return INNVIL_BUSINESS_PLUS_PRICE;
  if (tier === "business") return INNVIL_BUSINESS_PRICE;
  return INNVIL_PRO_PRICE;
}

/** Innvil Virtual Moderator — CUSTOMER-facing subscription prices (monthly, USD).
 *  This is a storefront product: the panel's CUSTOMER pays this from their own
 *  panel wallet (customer_accounts.balance), not the owner's Innvil balance —
 *  see src/lib/moderator/customer-entitlement.ts and actions/customer-moderator.ts.
 *  Reference point: ~$50/month for ONE human moderator; these tiers replace that
 *  with continuous, multi-slot AI coverage. Slot counts mirror the existing
 *  ModeratorCapacity table in moderator/plan.ts (CAPACITY) exactly — same tier
 *  names, same numbers, reused rather than duplicated. */
export const MODERATOR_BASIC_PRICE = 49.99;
export const MODERATOR_STANDARD_PRICE = 99.99;
export const MODERATOR_PREMIUM_PRICE = 179.99;
export const MODERATOR_PRO_PRICE = 299.99;
export const MODERATOR_PLAN_PERIOD_DAYS = 30;
/** Innvil-processed commission: panel owner's share of Innvil-collected customer
 *  revenue, credited to the panel's own Innvil balance per charge (§ "Ownership /
 *  revenue architecture" — customer pays the full price; the owner is credited
 *  this share, not the full amount; the remainder is Innvil's revenue). */
export const MODERATOR_COMMISSION_SHARE = 0.2;
/** More than this many Active Moderator Slots is Enterprise -- contact-only, no
 *  self-serve price or tier constant; see moderator/customer-entitlement.ts. */
export const MODERATOR_ENTERPRISE_MIN_SLOTS = 21;

export type ModeratorPlanTier = "basic" | "standard" | "premium" | "pro";
export function moderatorPlanPrice(tier: ModeratorPlanTier): number {
  if (tier === "pro") return MODERATOR_PRO_PRICE;
  if (tier === "premium") return MODERATOR_PREMIUM_PRICE;
  if (tier === "standard") return MODERATOR_STANDARD_PRICE;
  return MODERATOR_BASIC_PRICE;
}

/** Suggested default for the customer-facing automator subscription. Owners can override
 *  the price + run a promo (see automation/pricing.ts — the Business+ default is $9.99).
 *  The full amount is the OWNER's revenue; Innvil earns only via the owner's tier fee. */
export const CUSTOMER_AUTOMATOR_PRICE = 6.99;
export const AUTOMATOR_PERIOD_DAYS = 30;

/**
 * Internal volume-discount brackets by completed orders/day — the guideline support
 * (and future AI support) uses to grant a panel a lower commission rate. Public
 * messaging says "down to 2%"; internally we can go to 1% for the biggest panels.
 */
export function commissionBracketRate(ordersPerDay: number): number {
  if (ordersPerDay >= 10000) return 0.01;
  if (ordersPerDay >= 5000) return 0.02;
  if (ordersPerDay >= 2500) return 0.03;
  if (ordersPerDay >= 1000) return 0.04;
  return INNVIL_COMMISSION_RATE;
}

/* ---------------------------------------------------------------------------
   Currency — each panel operates in one well-known currency (default USD).
   --------------------------------------------------------------------------- */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  label: string;
}

/** Well-known currencies owners can operate in. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "PHP", symbol: "₱", label: "Philippine Peso" },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
  { code: "PKR", symbol: "₨", label: "Pakistani Rupee" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit" },
];

const SYMBOLS: Record<string, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c.symbol])
);

export function currencySymbol(code?: string | null): string {
  return SYMBOLS[(code || "USD").toUpperCase()] ?? "";
}

/** Format an amount in a panel's currency (symbol + 2dp; falls back to code). */
export function formatMoney(amount: number, code?: string | null): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const cc = (code || "USD").toUpperCase();
  const sym = SYMBOLS[cc];
  return sym ? `${sym}${n.toFixed(2)}` : `${n.toFixed(2)} ${cc}`;
}

/**
 * Selling rate (per 1000) from the provider cost and a markup rule:
 *  - percent:     cost * (1 + value/100)   e.g. value 20 → +20%
 *  - multiplier:  cost * value             e.g. value 1.5 → ×1.5
 *  - fixed:       cost + value             e.g. value 0.10 → +$0.10
 */
export function computeSellRate(
  providerRate: number,
  kind: MarkupKind,
  value: number
): number {
  const cost = Number.isFinite(providerRate) ? providerRate : 0;
  const v = Number.isFinite(value) ? value : 0;
  let rate: number;
  if (kind === "percent") rate = cost * (1 + v / 100);
  else if (kind === "multiplier") rate = cost * v;
  else rate = cost + v; // fixed
  return round4(Math.max(rate, 0));
}
