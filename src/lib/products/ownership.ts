import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasVirtualModerator } from "@/src/lib/moderator/plan";
import { WATCH_PRODUCT_SLUG } from "./watch";

/**
 * Neutral account-to-product ownership/entitlement resolution — the
 * application-layer counterpart to migration 0066 (`projects.account_id`,
 * `product_entitlements`). This is the FIRST place Watch entitlement can be
 * resolved WITHOUT going through a Panel — proving the architecture, not yet
 * rewiring every existing Virtual Moderator code path (those all continue
 * to work exactly as before, entirely unmodified, resolving through
 * `panels.settings`/`customer_moderator_entitlement`).
 *
 * `hasProductAccess()` combines two sources, in this order:
 *   1. `product_entitlements` — the new, account-level, product-generic
 *      source of truth (works identically for Forge/Watch/Herald/future).
 *   2. LEGACY COMPATIBILITY (Watch only, for now): does this account own
 *      any Panel with an active Virtual Moderator entitlement? This is
 *      exactly the "existing Panel-owner Watch distribution channel"
 *      the architecture doc requires stay functional — it does NOT mean
 *      "owning a Panel grants Watch" as a NEW rule; it means an EXISTING
 *      Panel-based Watch subscriber must keep working through this same
 *      resolver, since their entitlement genuinely still lives there.
 *      Forge ownership alone (a Panel with NO active moderator addon)
 *      grants nothing here.
 */
export async function hasProductAccess(admin: SupabaseClient, accountId: string, productSlug: string): Promise<boolean> {
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("id, status")
    .eq("account_id", accountId)
    .eq("product_id", await resolveProductId(admin, productSlug))
    .maybeSingle();
  if (entitlement && (entitlement.status === "active" || entitlement.status === "trial")) return true;

  if (productSlug === WATCH_PRODUCT_SLUG) {
    const { data: panels } = await admin.from("panels").select("settings").eq("owner_id", accountId);
    return (panels ?? []).some((p) => hasVirtualModerator(p.settings));
  }
  return false;
}

async function resolveProductId(admin: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await admin.from("products").select("id").eq("slug", slug).maybeSingle();
  return data?.id ?? null;
}

/**
 * Activates (or extends) a direct Watch subscription for an account —
 * called ONLY from the authoritative, server-verified payment webhook path
 * (`src/lib/payments/platform.ts`), never from a client-side "payment
 * succeeded" redirect. Idempotent by construction: the caller
 * (`handlePlatformWebhook`) already claims the deposit via a single
 * `status='pending' -> 'completed'` conditional UPDATE before this runs, so
 * a duplicate/retried webhook can never call this twice for the same
 * payment. Upserts on `(account_id, product_id)` — a renewal simply
 * updates the existing row rather than creating a duplicate entitlement.
 */
export async function activateWatchEntitlement(admin: SupabaseClient, accountId: string, tier: string, subscriptionRef: string): Promise<void> {
  const productId = await resolveProductId(admin, WATCH_PRODUCT_SLUG);
  if (!productId) return; // catalog row missing -- nothing to activate against, never fabricate one here
  await admin.from("product_entitlements").upsert(
    { account_id: accountId, product_id: productId, status: "active", subscription_ref: `${tier}:${subscriptionRef}`, activated_at: new Date().toISOString() },
    { onConflict: "account_id,product_id" }
  );
}

export interface StandaloneProjectResult {
  ok: boolean;
  projectId?: string;
  error?: string;
}

/**
 * Creates a Project owned directly by an Innvil account, with NO Panel at
 * all (`panel_id` is null — projects.panel_id is nullable as of migration
 * 0066). This is the concrete, working proof that "a Watch-entitled account
 * can create/use a Project without requiring a commercial SMM Panel" —
 * requires an active Watch entitlement first (never bypassable), same
 * least-privilege posture as every other resource-creation action in this
 * codebase.
 *
 * Deliberately stops at Project — Communities/Watchers still require a
 * Panel-distributed deployment path today (communities.panel_id/
 * moderator_deployments.panel_id are still NOT NULL); wiring THOSE through
 * account-only ownership is the documented next step, not built this pass.
 */
export async function createStandaloneProject(admin: SupabaseClient, accountId: string, name: string): Promise<StandaloneProjectResult> {
  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: "Project name can't be empty." };

  const entitled = await hasProductAccess(admin, accountId, WATCH_PRODUCT_SLUG);
  if (!entitled) return { ok: false, error: "This account doesn't have an active Innvil Watch entitlement." };

  const { data, error } = await admin
    .from("projects")
    .insert({ account_id: accountId, panel_id: null, name: trimmed })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the project." };
  return { ok: true, projectId: data.id };
}

/** Cross-tenant guard: true only when the project is genuinely owned by
 *  this account. Never trusts a client-supplied account id for the OTHER
 *  side of the comparison — callers must pass the server-validated
 *  authenticated account id. */
export function projectBelongsToAccount(project: { accountId: string }, accountId: string): boolean {
  return project.accountId === accountId;
}
