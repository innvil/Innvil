"use server";

/**
 * Superadmin-only, Preview-only control for manually granting a Watch
 * subscription tier to an account, for live QA -- e.g. testing a Watcher's
 * behavior against a real Standard/Premium/Pro entitlement without needing
 * a real crypto/Innvil-Credit payment to go through first.
 *
 * Two separate safety gates, both server-side (never only hidden in the UI):
 *  1. requireSuperAdmin() -- same role check every other superadmin action
 *     in this codebase uses (superadmin.ts).
 *  2. isPreviewEnvironment() -- the MUTATING actions (set/clear) additionally
 *     hard-fail outside Vercel's Preview environment. The READ action
 *     (getAccountDevOpsSubscription) is NOT gated on Preview -- a superadmin
 *     must still be able to SEE an account's real entitlement (including one
 *     granted this way) from the Production superadmin surface, since
 *     Preview and Production share the same database; only the ability to
 *     CREATE/REMOVE a devops override is Preview-only.
 *
 * "Brought live": Preview and Production read/write the exact same Supabase
 * project (confirmed this session) -- there is no separate promotion step.
 * A devops entitlement granted while testing on Preview is, immediately,
 * the account's real entitlement everywhere, including Production. What's
 * restricted to Preview is only the ACT of granting/revoking it this way.
 *
 * Reuses the SAME canonical entitlement-activation function every real paid
 * purchase already calls (activateWatchEntitlement, ownership.ts) -- never a
 * second/parallel entitlement-writing path. A devops grant is tagged
 * distinctly in `subscription_ref` (format "<tier>:devops:<superadminId>:
 * <timestamp>", vs. a real purchase's "<tier>:<depositId>") so it is
 * always visually distinguishable from a real paid subscription anywhere
 * subscription_ref is displayed, and so clearAccountDevOpsSubscription can
 * refuse to ever touch a real paid row.
 */

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { isPreviewEnvironment } from "@/src/lib/config";
import { activateWatchEntitlement } from "@/src/lib/products/ownership";
import { WATCH_PRODUCT_SLUG } from "@/src/lib/products/watch";
import type { ModeratorPlanTier } from "@/src/lib/money";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

const DEVOPS_MARKER = ":devops:";

async function requireSuperAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false };
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (data?.role !== "super_admin") return { ok: false };
  return { ok: true, userId: user.id };
}

function parseTierFromRef(subscriptionRef: string | null): ModeratorPlanTier | null {
  const tier = (subscriptionRef ?? "").split(":")[0];
  if (tier === "basic" || tier === "standard" || tier === "premium" || tier === "pro") return tier;
  return null;
}

/** Resolves an account id from an email (case-insensitive), for the
 *  superadmin search-by-email UI -- reuses the same auth_user_id_by_email
 *  RPC the branded password-reset flow already uses (migration 0038), never
 *  a second email->id lookup mechanism. */
export async function findAccountByEmail(email: string): Promise<Result<{ accountId: string; email: string }>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Enter an email address." };
  const admin = createAdminClient();
  const { data: accountId } = await admin.rpc("auth_user_id_by_email", { p_email: trimmed });
  if (!accountId) return { ok: false, error: "No account found with that email." };
  return { ok: true, data: { accountId: accountId as string, email: trimmed } };
}

export interface AccountDevOpsSubscriptionState {
  tier: ModeratorPlanTier | null;
  status: string | null;
  isDevOps: boolean;
  subscriptionRef: string | null;
}

/** Read-only -- NOT Preview-gated (see file header). */
export async function getAccountDevOpsSubscription(accountId: string): Promise<Result<AccountDevOpsSubscriptionState>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: true, data: { tier: null, status: null, isDevOps: false, subscriptionRef: null } };
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("subscription_ref, status")
    .eq("account_id", accountId)
    .eq("product_id", product.id)
    .maybeSingle();
  const subscriptionRef = (entitlement?.subscription_ref as string | null) ?? null;
  return {
    ok: true,
    data: {
      tier: parseTierFromRef(subscriptionRef),
      status: (entitlement?.status as string | null) ?? null,
      isDevOps: subscriptionRef?.includes(DEVOPS_MARKER) ?? false,
      subscriptionRef,
    },
  };
}

/** Grants (or replaces) a devops Watch subscription for the given account.
 *  Preview-only -- fails explicitly outside Preview, never a silent no-op. */
export async function setAccountDevOpsSubscription(accountId: string, tier: ModeratorPlanTier): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };
  if (!isPreviewEnvironment()) return { ok: false, error: "DevOps subscription overrides are only available in the Preview environment." };

  const admin = createAdminClient();
  const ref = `devops:${auth.userId}:${Date.now()}`;
  await activateWatchEntitlement(admin, accountId, tier, ref, "monthly");

  await admin.from("audit_logs").insert({
    panel_id: null,
    actor_id: auth.userId,
    action: "superadmin.watch_devops_subscription_set",
    meta: { accountId, tier, devops: true },
  });
  return { ok: true, data: null };
}

/** Revokes a devops Watch subscription -- refuses to touch anything that
 *  isn't itself devops-tagged, so this can never accidentally cancel a real
 *  paid subscription. Preview-only, same as setAccountDevOpsSubscription. */
export async function clearAccountDevOpsSubscription(accountId: string): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };
  if (!isPreviewEnvironment()) return { ok: false, error: "DevOps subscription overrides are only available in the Preview environment." };

  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Watch product not found." };
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("subscription_ref")
    .eq("account_id", accountId)
    .eq("product_id", product.id)
    .maybeSingle();
  const subscriptionRef = (entitlement?.subscription_ref as string | null) ?? null;
  if (!subscriptionRef?.includes(DEVOPS_MARKER)) {
    return { ok: false, error: "This account's current subscription is not a devops override -- refusing to clear a real subscription." };
  }

  const { error } = await admin
    .from("product_entitlements")
    .update({ status: "cancelled" })
    .eq("account_id", accountId)
    .eq("product_id", product.id);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    panel_id: null,
    actor_id: auth.userId,
    action: "superadmin.watch_devops_subscription_cleared",
    meta: { accountId },
  });
  return { ok: true, data: null };
}
