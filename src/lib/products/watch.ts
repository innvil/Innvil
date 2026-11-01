import "server-only";

import { createAdminClient } from "@/src/lib/supabase/admin";
import type { ProductRow } from "./catalog";

/**
 * Innvil Watch — the FIRST product wired through the generic Product
 * Catalog (Phase 2 of the multi-product architecture). This module is
 * deliberately THIN: it only resolves the canonical `products` row for
 * Watch. It does NOT reimplement, wrap, or duplicate any entitlement,
 * billing, Telegram, or moderation logic — that all continues to live
 * entirely in the existing Virtual Moderator system
 * (`src/lib/moderator/plan.ts`, `src/lib/moderator/customer-entitlement.ts`,
 * `src/lib/actions/moderator.ts`, `src/lib/actions/customer-moderator.ts`,
 * `src/lib/moderator/community-runtime.ts`, etc. — completely untouched by
 * this file). There is ONE Virtual Moderator backend; this is a read-only
 * identity pointer onto it, not a second implementation.
 *
 * Current state (honest, not aspirational): Watch ownership is STILL keyed
 * through `panels.id` under the hood (owner-side `panels.settings.addons
 * .moderator`, customer-side `customer_moderator_entitlement.panel_id`) —
 * this module does not change that. What it DOES establish is the canonical
 * product identity ("this feature IS Innvil Watch") that a later phase can
 * point a non-panel-owning entitlement path at, without redesigning
 * anything that already works. See CLAUDE.md's Phase 4.T architecture note
 * for the full coupling analysis and the proposed next step.
 */
export const WATCH_PRODUCT_SLUG = "watch" as const;

/** Resolves the canonical Innvil Watch product row, or null if the seed
 *  migration hasn't run / the row was retired. Never throws — a missing
 *  catalog entry must not break the existing Virtual Moderator surfaces,
 *  which have their own, independent entitlement checks and don't actually
 *  depend on this resolving successfully. */
export async function getWatchProduct(): Promise<ProductRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("products").select("*").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    slug: String(data.slug),
    name: String(data.name),
    description: (data.description as string | null) ?? null,
    status: data.status,
    domain: (data.domain as string | null) ?? null,
    standaloneAvailable: data.standalone_available === true,
    crossSellAvailable: data.cross_sell_available === true,
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at),
  };
}
