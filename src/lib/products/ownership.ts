import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasVirtualModerator } from "@/src/lib/moderator/plan";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { hasActiveWatchTrial } from "./watch-trial";
import { computeRenewedPeriod, type WatchBillingInterval } from "./watch-billing-period";

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
 *   2. DIRECT WATCH FREE TRIAL (Watch only): does this account hold an
 *      active, unexpired trial claim (watch-trial.ts's `watch_trial_claims`,
 *      migration 0079)? A temporary, one-time entitlement, structurally
 *      separate from `product_entitlements` so a later paid upgrade can
 *      overwrite/supersede the paid row without ever touching (or being
 *      able to accidentally resurrect) the durable trial-consumption record.
 *   3. LEGACY COMPATIBILITY (Watch only, for now): does this account own
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
    if (await hasActiveWatchTrial(admin, accountId)) return true;
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
 * Activates (or extends/renews) a direct Watch subscription for an account
 * — called ONLY from the authoritative, server-verified payment webhook
 * path (`src/lib/payments/platform.ts`) or from a verified Innvil-Credit
 * purchase (`innvil-credit.ts`'s `purchaseWatchWithCredit`), never from a
 * client-side "payment succeeded" redirect. Idempotent by construction for
 * the crypto path: the caller already claims the deposit via a single
 * `status='pending' -> 'completed'` conditional UPDATE before this runs, so
 * a duplicate/retried webhook can never call this twice for the same
 * payment.
 *
 * Establishes/extends the real billing period (migration 0080) via the ONE
 * canonical rule in `watch-billing-period.ts` — used identically whether
 * this is an initial purchase, an early or late renewal, or a plan change:
 * a still-valid existing period extends from its own END (never from
 * payment time); no existing period, or an already-expired one, starts a
 * fresh period from NOW. Plan changes deliberately reuse this SAME rule
 * (documented product decision, no proration/second timing model — see the
 * dated changelog entry) rather than inventing separate plan-change timing.
 *
 * Upserts on `(account_id, product_id)` — a renewal/plan-change simply
 * updates the existing row rather than creating a duplicate entitlement.
 *
 * `billingInterval` (default "monthly", preserving every existing caller's
 * behavior unchanged) determines only the EXTENSION LENGTH added by
 * `computeRenewedPeriod` -- switching interval mid-cycle needs no special
 * casing: paying annual while a monthly period is still active simply
 * extends from that period's own end by one year, and vice versa, so no
 * paid time is ever lost or double-charged (see watch-billing-period.ts's
 * own doc comment). `billing_interval` is stored as whatever the LATEST
 * successful payment specified -- it takes effect immediately (accurately
 * describing what governs the NEXT renewal), never scheduled for later,
 * since it doesn't change plan capacity, only renewal price/behavior. An
 * annual purchase always forces `renewal_mode: "innvil_credit"` (annual is
 * Innvil-Credit-only by product rule, enforced by callers, but stored here
 * too so Billing never has to re-derive it).
 */
export async function activateWatchEntitlement(admin: SupabaseClient, accountId: string, tier: string, subscriptionRef: string, billingInterval: WatchBillingInterval = "monthly"): Promise<void> {
  const productId = await resolveProductId(admin, WATCH_PRODUCT_SLUG);
  if (!productId) return; // catalog row missing -- nothing to activate against, never fabricate one here

  const { data: existing } = await admin
    .from("product_entitlements")
    .select("current_period_end")
    .eq("account_id", accountId)
    .eq("product_id", productId)
    .maybeSingle();

  const period = computeRenewedPeriod((existing?.current_period_end as string | null) ?? null, new Date(), billingInterval);

  await admin.from("product_entitlements").upsert(
    {
      account_id: accountId,
      product_id: productId,
      status: "active",
      subscription_ref: `${tier}:${subscriptionRef}`,
      activated_at: new Date().toISOString(),
      current_period_start: period.start,
      current_period_end: period.end,
      billing_interval: billingInterval,
      // Annual is Innvil-Credit-only by product rule -- force it here so
      // Billing never has to re-derive it. Monthly is deliberately left
      // OUT of this object (not overwritten) since it can legitimately be
      // paid by either crypto or credit and this field isn't yet surfaced
      // anywhere that would need that distinction.
      ...(billingInterval === "annual" ? { renewal_mode: "innvil_credit" } : {}),
    },
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

export interface AccountProjectRow {
  id: string;
  name: string;
  panelId: string | null;
  createdAt: string;
}

/** Every Project this account owns directly (`projects.account_id`) —
 *  covers BOTH standalone (`panel_id: null`) and Panel-backed projects, so
 *  a Watch dashboard can show the account's full picture regardless of
 *  which path created each one. */
export async function listAccountProjects(admin: SupabaseClient, accountId: string): Promise<AccountProjectRow[]> {
  const { data } = await admin
    .from("projects")
    .select("id, name, panel_id, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    panelId: (r.panel_id as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}
