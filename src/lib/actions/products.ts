"use server";

/**
 * Superadmin-only management of the official Innvil Product Catalog
 * (Innvil Forge / Innvil Watch / Innvil Herald / future products). Mirrors
 * the exact `requireSuperAdmin()` gating pattern already established in
 * `actions/superadmin.ts` (role read via the service-role client, keyed by
 * the validated auth user id — never trusted from the client). Every export
 * here re-checks the role itself; a non-superadmin gets rejected
 * server-side regardless of what the UI shows.
 *
 * This is deliberately separate from panel-owner service-catalog actions
 * (`actions/services.ts`) — an official Product is Innvil's own software
 * offering, never something a panel owner or ordinary admin can create.
 */

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { validateProductInput, type ProductInput, type ProductRow, type ProductStatus } from "@/src/lib/products/catalog";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireSuperAdmin(): Promise<boolean> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "super_admin";
}

function toRow(r: Record<string, unknown>): ProductRow {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    status: r.status as ProductStatus,
    domain: (r.domain as string | null) ?? null,
    standaloneAvailable: r.standalone_available === true,
    crossSellAvailable: r.cross_sell_available === true,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Every superadmin action here — including reads — re-verifies the role;
 *  this list is never shown to a non-superadmin regardless of UI state. */
export async function listProducts(): Promise<ProductRow[]> {
  if (!(await requireSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("products").select("*").order("created_at", { ascending: true });
  return ((data as Array<Record<string, unknown>>) ?? []).map(toRow);
}

export async function createProduct(input: ProductInput): Promise<Result<ProductRow>> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Super admin only." };
  const validation = validateProductInput(input);
  if (!validation.ok) return { ok: false, error: validation.error! };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .insert({
      slug: input.slug.trim(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? "draft",
      domain: input.domain?.trim() || null,
      standalone_available: input.standaloneAvailable ?? false,
      cross_sell_available: input.crossSellAvailable ?? false,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "That slug is already in use." : error?.message ?? "Could not create the product." };
  return { ok: true, data: toRow(data) };
}

/** Partial update — `slug` is immutable once created (the product's stable
 *  identity key) so it's intentionally NOT accepted here; only display/
 *  lifecycle metadata can change. Changing `name`/`description`/etc. must
 *  never affect any existing customer's ownership, which is why nothing in
 *  this table is ever used as an ownership foreign key elsewhere — callers
 *  reference the immutable `id` (or the stable `slug`), never `name`. */
export async function updateProduct(id: string, patch: Partial<Omit<ProductInput, "slug">>): Promise<Result<ProductRow>> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();

  if (patch.name !== undefined || patch.status !== undefined || patch.domain !== undefined) {
    const validation = validateProductInput({ slug: "placeholder", name: patch.name ?? "placeholder", status: patch.status, domain: patch.domain ?? undefined });
    if (!validation.ok) return { ok: false, error: validation.error! };
  }

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.domain !== undefined) update.domain = patch.domain?.trim() || null;
  if (patch.standaloneAvailable !== undefined) update.standalone_available = patch.standaloneAvailable;
  if (patch.crossSellAvailable !== undefined) update.cross_sell_available = patch.crossSellAvailable;

  const { data, error } = await admin.from("products").update(update).eq("id", id).select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not update the product." };
  return { ok: true, data: toRow(data) };
}

/** Convenience wrapper over updateProduct for the common lifecycle actions
 *  (Publish/Activate, Hide, Retire) — never a destructive delete; retiring
 *  a product is a status change, existing owners are unaffected by this
 *  catalog layer (their entitlement lives in that product's own system). */
export async function setProductStatus(id: string, status: ProductStatus): Promise<Result<ProductRow>> {
  return updateProduct(id, { status });
}
