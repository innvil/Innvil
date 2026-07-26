/**
 * Super-admin design pricing overrides + per-design promotions.
 *
 * Design base prices live in each package's `meta.price`; a super admin can override
 * the price and set a per-design promo (e.g. a first-purchase price) without touching
 * code. Stored in `platform_settings` under key `design_pricing`. Pure/serialisable.
 */

export interface DesignPricingEntry {
  /** Override the package's base price (undefined = use meta.price). */
  price?: number;
  /** First-purchase promotion. */
  promoActive?: boolean;
  /** Promo price applied to a buyer's FIRST design purchase on a panel. */
  promoPrice?: number;
  /** Short label shown on the promo badge (default "First purchase"). */
  promoLabel?: string;
}

export type DesignPricingMap = Record<string, DesignPricingEntry>;

export interface EffectivePrice {
  /** What the buyer pays right now. */
  price: number;
  /** The regular (non-promo) price, for strike-through display. */
  base: number;
  /** True when a promo is being applied. */
  isPromo: boolean;
  label: string;
}

/** Resolve the price a specific buyer sees for a design. */
export function effectivePrice(
  basePrice: number,
  entry: DesignPricingEntry | undefined,
  opts: { firstPurchase: boolean },
): EffectivePrice {
  const base = typeof entry?.price === "number" && entry.price >= 0 ? entry.price : basePrice;
  const promoOn =
    !!entry?.promoActive &&
    typeof entry?.promoPrice === "number" &&
    entry.promoPrice >= 0 &&
    entry.promoPrice < base &&
    opts.firstPurchase;
  return {
    price: promoOn ? (entry!.promoPrice as number) : base,
    base,
    isPromo: promoOn,
    label: entry?.promoLabel?.trim() || "First purchase",
  };
}

/** Whether a design has an active promo at all (for badges when no buyer context). */
export function hasActivePromo(entry: DesignPricingEntry | undefined): boolean {
  return !!entry?.promoActive && typeof entry?.promoPrice === "number";
}
