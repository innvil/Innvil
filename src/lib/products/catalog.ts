/**
 * Innvil Product Catalog — Phase 1 of the multi-product architecture.
 *
 * This is the GENERIC identity/lifecycle model for OFFICIAL Innvil products
 * (Innvil Forge, Innvil Watch, Innvil Herald, future products) — pure types
 * and validation, no I/O. Deliberately does NOT know anything about a
 * specific product's plans/subscriptions/entitlements: those stay in that
 * product's own existing system (e.g. Virtual Moderator entitlement remains
 * entirely in panels.settings / customer_moderator_entitlement, untouched
 * by this file).
 *
 * Hard boundary: an OFFICIAL Innvil Product (this catalog) is NOT the same
 * thing as an SMM service a panel owner sells through their own panel
 * catalog (src/lib/actions/services.ts). The two are structurally
 * unrelated — this file has no reference to `services`/`provider_service`
 * at all, and never will.
 */

export type ProductStatus = "draft" | "private_beta" | "active" | "hidden" | "retired";

export const PRODUCT_STATUSES: ProductStatus[] = ["draft", "private_beta", "active", "hidden", "retired"];

/** Stable, hand-assigned identity keys — the ONLY place these string
 *  literals should be hardcoded outside the seed migration/tests. A
 *  product's `name` (display label) is mutable; `slug` is not, and nothing
 *  should ever key ownership off `name`. */
export type ProductSlug = "forge" | "watch" | "herald" | (string & {});

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  domain: string | null;
  standaloneAvailable: boolean;
  crossSellAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Whether a product is currently obtainable by a NEW customer (spec's
 *  ACTIVE/PRIVATE_BETA lifecycle states) — HIDDEN/RETIRED existing owners
 *  keep access (that's an entitlement-layer concern, not this catalog's),
 *  but neither should ever be offered for a fresh purchase. DRAFT is
 *  internal-only. */
export function productPurchasable(status: ProductStatus): boolean {
  return status === "active" || status === "private_beta";
}

export interface ProductInput {
  slug: string;
  name: string;
  description?: string | null;
  status?: ProductStatus;
  domain?: string | null;
  standaloneAvailable?: boolean;
  crossSellAvailable?: boolean;
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,49}$/;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/** Pure validation, shared by create/update so both go through the exact
 *  same rules — never duplicated inline in the action layer. */
export function validateProductInput(input: ProductInput): ValidationResult {
  const slug = input.slug?.trim() ?? "";
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: "Slug must be lowercase letters/numbers/hyphens, starting with a letter (2-50 chars)." };
  }
  const name = input.name?.trim() ?? "";
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 120) return { ok: false, error: "Keep the name under 120 characters." };
  if (input.status && !PRODUCT_STATUSES.includes(input.status)) return { ok: false, error: "Invalid status." };
  if (input.domain) {
    const domain = input.domain.trim();
    if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return { ok: false, error: "Domain doesn't look like a valid hostname." };
  }
  return { ok: true };
}
