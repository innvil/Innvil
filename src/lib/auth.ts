import "server-only";
import { createClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import type { ProfileRow, UserRole } from "@/src/types/db";
import {
  hasProfileRoleIntentMarker,
  inspectProfileRoleIntent,
  profileRoleIntentMetadata,
  resolveTrustedProfileRole,
  type ProfileRecoveryDecision,
  type RecoverableProfileRole,
} from "@/src/lib/auth/profile-recovery";

export const PROFILE_SETUP_ATTENTION_MESSAGE =
  "Your account is authenticated, but account setup requires attention. Please contact support.";

export const PROFILE_SETUP_RETRY_MESSAGE =
  "We couldn't finish setting up your account. Please try again or contact support.";

export class ProfileWriteError extends Error {
  constructor() {
    super("Profile setup failed");
    this.name = "ProfileWriteError";
  }
}

function diagnosticCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(code) ? code : "unknown";
}

function logProfileDiagnostic(operation: string, error: unknown): void {
  console.error("[auth] profile operation failed", {
    operation,
    code: diagnosticCode(error),
  });
}

/**
 * Server-side auth helpers. RLS-aware: reads run as the signed-in user via the
 * cookie-based server client. Profile creation uses the service-role client
 * because `profiles` has no self-insert policy (rows are created by the
 * auth.users trigger, or by this fallback when that trigger couldn't install).
 */

/** The authenticated Supabase user, or null. Validates the JWT with the auth server. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns a server client together with the current user. Calling getUser() here
 * hydrates the session ON THIS client, so any DB query made with the returned
 * `supabase` carries the user's JWT (and RLS `auth.uid()` resolves correctly).
 * Use for reads where RLS should scope results.
 */
export async function getAuthedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Validated identity + a service-role client that BYPASSES RLS. Use in trusted
 * server actions that enforce ownership in code (e.g. force owner_id = user.id,
 * or verify a panel belongs to the user before touching it). `user` is validated
 * against the auth server; `admin` must never be exposed to the client.
 */
export async function getAuthedAdmin() {
  const user = await getUser();
  return { user, admin: createAdminClient() };
}

/** The current user's profile row, or null. */
export async function getProfile(): Promise<ProfileRow | null> {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return (data as ProfileRow) ?? null;
}

/**
 * Ensure a profile row exists for a user (fallback for the auth.users trigger).
 * Insert-if-absent — never overwrites an existing role/display_name.
 */
export async function ensureProfile(
  userId: string,
  role: UserRole,
  displayName?: string | null
) {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .upsert(
        { id: userId, role, display_name: displayName ?? null },
        { onConflict: "id", ignoreDuplicates: true }
      );
    if (error) {
      logProfileDiagnostic("ensure_profile", error);
      throw new ProfileWriteError();
    }
  } catch (error) {
    if (error instanceof ProfileWriteError) throw error;
    logProfileDiagnostic("ensure_profile", error);
    throw new ProfileWriteError();
  }
}

/**
 * Provision a just-created customer account without changing any pre-existing
 * account role. The Auth trigger may have inserted the new row with the
 * schema's panel_owner default before this server action runs.
 */
export async function ensureNewCustomerProfile(
  userId: string,
  displayName?: string | null
): Promise<void> {
  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (lookupError) {
    logProfileDiagnostic("ensure_customer_profile_lookup", lookupError);
    throw new ProfileWriteError();
  }

  if (!existing) {
    await ensureProfile(userId, "customer", displayName);
    return;
  }

  const existingRole = existing.role as UserRole;
  if (existingRole === "customer") return;
  if (existingRole !== "panel_owner") {
    logProfileDiagnostic("ensure_customer_profile_role_conflict", { code: "ROLE_CONFLICT" });
    throw new ProfileWriteError();
  }

  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update({ role: "customer" })
    .eq("id", userId)
    .eq("role", "panel_owner")
    .select("role")
    .maybeSingle();
  if (updateError) {
    logProfileDiagnostic("ensure_customer_profile_update", updateError);
    throw new ProfileWriteError();
  }
  if (updated?.role !== "customer") {
    logProfileDiagnostic("ensure_customer_profile_role_conflict", { code: "ROLE_CONFLICT" });
    throw new ProfileWriteError();
  }
}

/** Store a role intent written only by trusted server code, never by signup input. */
export async function setProfileRoleIntent(
  userId: string,
  currentAppMetadata: unknown,
  role: RecoverableProfileRole
): Promise<void> {
  try {
    const existing = currentAppMetadata && typeof currentAppMetadata === "object"
      ? currentAppMetadata as Record<string, unknown>
      : {};
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...existing, ...profileRoleIntentMetadata(role) },
    });
    if (error) {
      logProfileDiagnostic("set_profile_role_intent", error);
      throw new ProfileWriteError();
    }
  } catch (error) {
    if (error instanceof ProfileWriteError) throw error;
    logProfileDiagnostic("set_profile_role_intent", error);
    throw new ProfileWriteError();
  }
}

/** Remove the one-time recovery marker after a profile is safely present. */
export async function clearProfileRoleIntent(
  userId: string,
  currentAppMetadata: unknown
): Promise<void> {
  try {
    const next = currentAppMetadata && typeof currentAppMetadata === "object"
      ? {
          ...(currentAppMetadata as Record<string, unknown>),
          profile_role_intent: null,
          profile_role_intent_expires_at: null,
        }
      : {};
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: next });
    if (error) {
      logProfileDiagnostic("clear_profile_role_intent", error);
      throw new ProfileWriteError();
    }
  } catch (error) {
    if (error instanceof ProfileWriteError) throw error;
    logProfileDiagnostic("clear_profile_role_intent", error);
    throw new ProfileWriteError();
  }
}

/**
 * Recover a missing profile only from server-side relationship evidence.
 * Existing profiles are never written, so their roles remain authoritative.
 */
export async function recoverProfileForUser(
  userId: string,
  appMetadata?: unknown
): Promise<
  | { ok: true; role: UserRole; created: boolean }
  | {
      ok: false;
      reason: "role_unverified" | "conflicting_role_evidence" | "role_intent_invalid" | "role_intent_expired" | "database";
    }
> {
  try {
    const admin = createAdminClient();
    const { data: existing, error: profileError } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      logProfileDiagnostic("profile_recovery_lookup", profileError);
      return { ok: false, reason: "database" };
    }
    const roleIntent = inspectProfileRoleIntent(appMetadata);
    if (existing) {
      if (hasProfileRoleIntentMarker(appMetadata)) {
        try {
          await clearProfileRoleIntent(userId, appMetadata);
        } catch {
          // The existing profile remains authoritative; cleanup can be retried.
          console.warn("[auth] profile role marker cleanup deferred");
        }
      }
      return { ok: true, role: existing.role as UserRole, created: false };
    }

    const [customerResult, ownerResult, memberResult] = await Promise.all([
      admin.from("customer_accounts").select("id").eq("user_id", userId).limit(1).maybeSingle(),
      admin.from("panels").select("id").eq("owner_id", userId).limit(1).maybeSingle(),
      admin.from("panel_members").select("panel_id").eq("user_id", userId).limit(1).maybeSingle(),
    ]);
    const evidenceError = customerResult.error ?? ownerResult.error ?? memberResult.error;
    if (evidenceError) {
      logProfileDiagnostic("profile_recovery_evidence", evidenceError);
      return { ok: false, reason: "database" };
    }

    const relationshipDecision: ProfileRecoveryDecision = resolveTrustedProfileRole({
      hasCustomerAccount: Boolean(customerResult.data),
      ownsPanel: Boolean(ownerResult.data),
      isPanelMember: Boolean(memberResult.data),
    });

    if (!roleIntent.ok && roleIntent.reason !== "missing") {
      console.warn("[auth] profile recovery skipped", { reason: roleIntent.reason });
      return {
        ok: false,
        reason: roleIntent.reason === "expired" ? "role_intent_expired" : "role_intent_invalid",
      };
    }

    if (roleIntent.ok) {
      if (relationshipDecision.ok && relationshipDecision.role !== roleIntent.role) {
        console.warn("[auth] profile recovery skipped", { reason: "conflicting_role_evidence" });
        return { ok: false, reason: "conflicting_role_evidence" };
      }
      await ensureProfile(userId, roleIntent.role);
      await clearProfileRoleIntent(userId, appMetadata);
      return { ok: true, role: roleIntent.role, created: true };
    }

    if (!relationshipDecision.ok) {
      console.warn("[auth] profile recovery skipped", { reason: relationshipDecision.reason });
      return relationshipDecision;
    }

    await ensureProfile(userId, relationshipDecision.role);
    return { ok: true, role: relationshipDecision.role, created: true };
  } catch (error) {
    if (error instanceof ProfileWriteError) return { ok: false, reason: "database" };
    logProfileDiagnostic("profile_recovery", error);
    return { ok: false, reason: "database" };
  }
}

/** True when the current user holds one of the given roles. */
export async function hasRole(...roles: UserRole[]): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && roles.includes(profile.role);
}
