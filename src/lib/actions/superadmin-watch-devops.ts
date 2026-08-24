"use server";

/**
 * Superadmin-only control for manually granting a Watch subscription/
 * Enterprise entitlement to an account. Originally built (2026-08) as a
 * Preview-only QA convenience; as of 2026-08-25 this is a real operational
 * tool used in every environment, including Production -- there is no
 * self-serve checkout for Enterprise anywhere in this codebase (Managed or
 * BYO), so manual devops provisioning is the ONLY way a real Enterprise
 * customer is ever onboarded. Restricting it to Preview stopped making
 * sense once that became true; the real security boundary is, and always
 * was, requireSuperAdmin() -- same role check every other superadmin
 * action in this codebase uses (superadmin.ts). Preview and Production
 * read/write the exact same Supabase project, so a grant made from either
 * is immediately the account's real entitlement everywhere.
 *
 * Reuses the SAME canonical entitlement-activation function every real paid
 * purchase already calls (activateWatchEntitlement, ownership.ts) -- never a
 * second/parallel entitlement-writing path. A devops grant is tagged
 * distinctly in `subscription_ref` (format "<tier>:devops:<superadminId>:
 * <timestamp>", vs. a real purchase's "<tier>:<depositId>") so it is
 * always visually distinguishable from a real paid subscription anywhere
 * subscription_ref is displayed, and so clearAccountDevOpsSubscription can
 * refuse to ever touch a real paid row.
 *
 * BYO CREDENTIAL BOUNDARY: this file can flip an Enterprise account's
 * `apiSourceMode` to "byo" (metadata) and can REVOKE a stored credential
 * (clearAccountDevOpsByoCredential -- possesses nothing secret to do so),
 * but it deliberately has NO action that lets an admin ENTER a customer's
 * API key. That's a customer secret; an Innvil operator must never see,
 * type, or relay it. The only place a BYO credential is ever stored is the
 * customer's own self-serve flow (watch-byo-settings.ts / the account's own
 * "AI Provider" Settings tab), authenticated as the customer. See the doc
 * comment on clearAccountDevOpsByoCredential below for the fuller rationale.
 */

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { activateWatchEntitlement } from "@/src/lib/products/ownership";
import { WATCH_PRODUCT_SLUG } from "@/src/lib/products/watch";
import { validateEnterpriseCommunityCapacity, communityModeFor } from "@/src/lib/products/watch-enterprise-community";
import { hasByoCredential, clearAccountByoCredential } from "@/src/lib/products/watch-byo";
import { WATCH_ENTERPRISE_BYO_TIERS } from "@/src/lib/products/watch-enterprise";
import type { WatchBillingInterval } from "@/src/lib/products/watch-billing-period";
import type { ModeratorPlanTier } from "@/src/lib/money";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

const DEVOPS_MARKER = ":devops:";

/** A devops-grantable tier -- the 4 real self-serve tiers, or "enterprise",
 *  which is structurally NOT a ModeratorPlanTier anywhere else in this
 *  codebase (see watch-runtime.ts's own doc comments) -- kept as a distinct
 *  union here too, never silently widened into ModeratorPlanTier. */
export type DevOpsGrantableTier = ModeratorPlanTier | "enterprise";

async function requireSuperAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false };
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (data?.role !== "super_admin") return { ok: false };
  return { ok: true, userId: user.id };
}

function parseTierFromRef(subscriptionRef: string | null): DevOpsGrantableTier | null {
  const tier = (subscriptionRef ?? "").split(":")[0];
  if (tier === "basic" || tier === "standard" || tier === "premium" || tier === "pro" || tier === "enterprise") return tier;
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
  tier: DevOpsGrantableTier | null;
  status: string | null;
  isDevOps: boolean;
  subscriptionRef: string | null;
  /** Only meaningful when tier === "enterprise" -- the REAL, manually-
   *  provisioned Watcher-slot count (migration 0086). Null otherwise. */
  enterpriseSlots: number | null;
  /** Only meaningful when tier === "enterprise" -- the REAL, manually-
   *  provisioned Community capacity (migration 0088). Null means "base
   *  package, no expansion" -- never a fabricated number here either;
   *  the resolver (watch-runtime.ts) is what applies the real base-8
   *  fallback at read time for the live product, this is just the raw
   *  stored value for the admin's own visibility. */
  enterpriseCommunityCapacity: number | null;
  /** "managed" | "byo" -- only meaningful when tier === "enterprise".
   *  Defaults to "managed" for a null/unset stored value, mirroring the
   *  same resolver-side default in watch-runtime.ts. */
  apiSourceMode: "managed" | "byo";
  /** True when a BYO credential is currently stored for this account
   *  (watch-byo.ts) -- a cheap existence check, never the credential
   *  itself. Meaningful regardless of apiSourceMode (an admin may store a
   *  credential before or after flipping the mode). */
  hasByoCredential: boolean;
  /** Only meaningful when tier === "enterprise" -- whether Media
   *  Moderation + has been explicitly granted (migration 0097). False for
   *  every non-enterprise/no-entitlement account. */
  mediaAddonActive: boolean;
  /** "monthly" | "annual" -- the account's REAL stored billing interval
   *  (migration 0080), meaningful for every granted tier, not just
   *  Enterprise. Defaults to "monthly" for a null/unset stored value. */
  billingInterval: "monthly" | "annual";
}

/** Read-only -- NOT Preview-gated (see file header). */
export async function getAccountDevOpsSubscription(accountId: string): Promise<Result<AccountDevOpsSubscriptionState>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  const byoCredentialStored = await hasByoCredential(admin, accountId);
  if (!product) {
    return {
      ok: true,
      data: {
        tier: null, status: null, isDevOps: false, subscriptionRef: null, enterpriseSlots: null, enterpriseCommunityCapacity: null,
        apiSourceMode: "managed", hasByoCredential: byoCredentialStored, mediaAddonActive: false, billingInterval: "monthly",
      },
    };
  }
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("subscription_ref, status, enterprise_slots, enterprise_community_capacity, api_source_mode, enterprise_media_addon, billing_interval")
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
      enterpriseSlots: (entitlement?.enterprise_slots as number | null) ?? null,
      enterpriseCommunityCapacity: (entitlement?.enterprise_community_capacity as number | null) ?? null,
      apiSourceMode: entitlement?.api_source_mode === "byo" ? "byo" : "managed",
      hasByoCredential: byoCredentialStored,
      mediaAddonActive: entitlement?.enterprise_media_addon === true,
      billingInterval: entitlement?.billing_interval === "annual" ? "annual" : "monthly",
    },
  };
}

/** Grants (or replaces) a devops Watch subscription for the given account.
 *  This is the ONLY grant path for Enterprise (see setAccountDevOpsEnterprise
 *  below) -- there is no self-serve Enterprise checkout anywhere in this
 *  codebase, so this action must work in every real environment, not just
 *  Preview (explicit product decision, 2026-08-25 -- previously
 *  Preview-only for QA safety; now a real operational tool for onboarding
 *  actual customers). Superadmin-only remains the real security boundary. */
export async function setAccountDevOpsSubscription(accountId: string, tier: ModeratorPlanTier): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

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

/** Grants (or replaces) a devops Managed/BYO Enterprise entitlement -- the
 *  ONLY grant path anywhere in this codebase for an actual account to
 *  receive Enterprise capacity (no self-serve Enterprise checkout exists,
 *  so this must work in every real environment -- see the 2026-08-25 note
 *  on setAccountDevOpsSubscription above, same rationale). Kept as its OWN
 *  function rather than widening setAccountDevOpsSubscription's tier
 *  parameter -- "enterprise" is a structurally distinct entitlement source
 *  everywhere else in this codebase (watch-runtime.ts), never a
 *  ModeratorPlanTier value, so this mirrors that distinction instead of
 *  blurring it.
 *
 *  `slots`:
 *   - Managed: any real, positive Watcher-slot count (the same floor
 *     resolveAccountEnterpriseEntitlement itself enforces) -- Managed's
 *     pricing genuinely scales per-slot above the base 50 package, so a
 *     free-form count is correct here.
 *   - BYO: MUST be exactly one of the two real priced packages --
 *     WATCH_ENTERPRISE_BYO_TIERS' own maxSlots values (50, or `null` for
 *     BYO Unlimited) -- never an arbitrary custom number. There is no
 *     "Managed Unlimited" package, so `null` is rejected outright when
 *     apiSourceMode isn't "byo".
 *  `communityCapacity` is OPTIONAL -- omitted or `undefined` leaves it
 *  unset, which the real resolver already treats as "base package" (8
 *  Communities); when given, it's validated against the canonical package
 *  matrix BEFORE ever being persisted -- an invalid value is rejected with
 *  a clear error here (not silently dropped, unlike activateWatchEntitlement's
 *  own internal write-time guard, since this is a direct admin action that
 *  deserves real feedback rather than a silent no-op).
 *
 *  `apiSourceMode` (default "managed") flags which routing mode the live
 *  AI runtime resolves for this account (see resolveAccountAiRouting in
 *  watch-runtime.ts). Setting it to "byo" does NOT itself store a
 *  credential -- the customer must still store their own key via their own
 *  Settings -> AI Provider tab (watch-byo-settings.ts) before any BYO call
 *  can actually succeed; neither step is required to grant the entitlement
 *  itself. This action never touches the credential in any way.
 *
 *  `mediaAddon` (optional, `undefined` = leave whatever was already
 *  provisioned untouched) explicitly grants/revokes Enterprise Media
 *  Moderation + -- see AccountEnterpriseEntitlement's own doc comment
 *  (watch-runtime.ts) for the grandfather-default rationale on existing rows.
 *
 *  `billingInterval` (default "monthly") -- Enterprise billing is entirely
 *  manual/negotiated (there's no self-serve checkout for it anywhere in this
 *  codebase), but the account's `product_entitlements.billing_interval` and
 *  period length are still real, stored fields every other Watch surface
 *  (Billing page, expiry checks) reads -- this just lets that reflect an
 *  annual arrangement finalized outside the app, the same way it already
 *  does for every self-serve tier. */
export async function setAccountDevOpsEnterprise(
  accountId: string, slots: number | null, communityCapacity?: number, apiSourceMode?: "managed" | "byo", mediaAddon?: boolean,
  billingInterval: WatchBillingInterval = "monthly"
): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };
  const mode = apiSourceMode ?? "managed";
  if (slots === null) {
    if (mode !== "byo") return { ok: false, error: "Unlimited slots is only a real package under BYO -- Managed has no Unlimited tier." };
  } else if (!Number.isInteger(slots) || slots < 1) {
    return { ok: false, error: "Watcher slots must be a whole number of at least 1." };
  } else if (mode === "byo" && !WATCH_ENTERPRISE_BYO_TIERS.some((t) => t.maxSlots === slots)) {
    const options = WATCH_ENTERPRISE_BYO_TIERS.map((t) => t.label).join(" or ");
    return { ok: false, error: `BYO Enterprise is only sold as ${options} -- pick one of the real priced packages, not a custom slot count.` };
  }
  // The valid Community-capacity package matrix is different PER MODE (see
  // watch-enterprise-community.ts's own table: Managed base 8, BYO 50/BYO
  // Unlimited both base 10, with BYO Unlimited's own UNCAPPED +10-block
  // continuation beyond 25 -- there is no fixed maximum for that mode) --
  // this used to always validate against "managed" regardless of the account
  // actually being granted BYO, which both rejected every valid BYO
  // Unlimited capacity beyond 25 and silently accepted a capacity that only
  // happened to coincide with a Managed package number. Uses the ONE
  // canonical (mode, slots) -> community-mode mapping (communityModeFor,
  // watch-enterprise-community.ts) -- the SAME function the grant UI and
  // activateWatchEntitlement's own persistence-time re-validation now both
  // use too, so all three can never disagree about which mode an account is
  // actually being granted.
  const communityMode = communityModeFor(mode, slots);
  if (communityCapacity != null && !validateEnterpriseCommunityCapacity(communityMode, communityCapacity)) {
    return { ok: false, error: `${communityCapacity} isn't a real ${communityMode === "managed" ? "Managed Enterprise" : communityMode === "byo50" ? "BYO Enterprise 50" : "BYO Enterprise Unlimited"} Community capacity package.` };
  }

  const admin = createAdminClient();
  const ref = `devops:${auth.userId}:${Date.now()}`;
  await activateWatchEntitlement(admin, accountId, "enterprise", ref, billingInterval, slots, communityCapacity, apiSourceMode, mediaAddon);

  await admin.from("audit_logs").insert({
    panel_id: null,
    actor_id: auth.userId,
    action: "superadmin.watch_devops_enterprise_set",
    meta: { accountId, slots, communityCapacity: communityCapacity ?? null, apiSourceMode: mode, mediaAddon: mediaAddon ?? null, billingInterval, devops: true },
  });
  return { ok: true, data: null };
}

/** Revokes (clears) a BYO account's stored AI provider credential --
 *  Preview-only, same gate as every other mutating action in this file.
 *
 *  DELIBERATE SECURITY BOUNDARY: there is NO corresponding "set" action in
 *  this file. A superadmin can flag an account BYO and can REVOKE a
 *  credential (both are metadata-only / possess-nothing-secret operations),
 *  but can never ENTER one -- a customer's own API key is their sensitive
 *  credential, and Innvil operations staff must never see, type, receive,
 *  or otherwise come into possession of it. The self-serve path
 *  (watch-byo-settings.ts / the "AI Provider" Settings tab) is the ONLY
 *  place a BYO credential is ever stored -- the customer enters their own
 *  key directly, authenticated as themselves, never relayed through
 *  support/devops. This was corrected after an explicit review: an earlier
 *  version of this file had a `setAccountDevOpsByoCredential` action (and a
 *  matching admin-facing "paste an API key here" form) that let an admin
 *  type a customer's credential in on their behalf -- removed outright,
 *  not just hidden, since the whole point is that this codepath must not
 *  exist for an admin to reach for under pressure (e.g. "just do it for me
 *  over a support ticket"). If a customer can't reach their own Settings
 *  page, the fix is to help them get there, never to accept their key
 *  through any other channel. */
export async function clearAccountDevOpsByoCredential(accountId: string): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const admin = createAdminClient();
  await clearAccountByoCredential(admin, accountId);

  await admin.from("audit_logs").insert({
    panel_id: null,
    actor_id: auth.userId,
    action: "superadmin.watch_devops_byo_credential_cleared",
    meta: { accountId },
  });
  return { ok: true, data: null };
}

/** Revokes a devops Watch subscription -- refuses to touch anything that
 *  isn't itself devops-tagged, so this can never accidentally cancel a real
 *  paid subscription. */
export async function clearAccountDevOpsSubscription(accountId: string): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

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
