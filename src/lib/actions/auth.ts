"use server";

import { headers } from "next/headers";
import { createClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import {
  PROFILE_SETUP_ATTENTION_MESSAGE,
  PROFILE_SETUP_RETRY_MESSAGE,
  clearProfileRoleIntent,
  recoverProfileForUser,
  setProfileRoleIntent,
  ensureProfile,
} from "@/src/lib/auth";
import { isTrustedWatchHost } from "@/src/lib/config";
import { signupProductForHost } from "@/src/lib/auth/signup-product";
import { publicSignupOutcome } from "@/src/lib/auth/signup-profile";
import { trustedRoleIntentFromAppMetadata } from "@/src/lib/auth/profile-recovery";

type AuthResult =
  | { ok: true; needsConfirmation?: boolean }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Resolves a username to its login email, GLOBALLY across every Innvil
 * account (`profiles.display_name`) -- not panel-scoped, since one Innvil
 * account grants access to Watch and every other Innvil product alike
 * (mirrors `customer-auth.ts`'s `emailForUsername`, which does the same
 * lookup scoped to one panel's customers). `display_name` has no uniqueness
 * constraint, so an ambiguous match (2+ accounts sharing the same username)
 * is deliberately treated as "not found" rather than guessing which account
 * to sign in as.
 */
async function emailForAccountUsername(username: string): Promise<string | null> {
  const admin = createAdminClient();
  const uname = username.trim().toLowerCase();
  if (!uname) return null;
  const { data } = await admin.from("profiles").select("id, display_name");
  const matches = ((data as Array<{ id: string; display_name: string | null }> | null) ?? [])
    .filter((p) => (p.display_name ?? "").trim().toLowerCase() === uname);
  if (matches.length !== 1) return null;
  try {
    const { data: userData } = await admin.auth.admin.getUserById(matches[0].id);
    return userData.user?.email ?? null;
  } catch {
    return null;
  }
}

/** Sign in a panel owner / staff / super admin with an email OR username + password. */
export async function signInAction(
  identifier: string,
  password: string
): Promise<AuthResult> {
  let email = identifier.trim();
  if (!EMAIL_RE.test(email)) {
    const resolved = await emailForAccountUsername(email);
    if (!resolved) return { ok: false, error: "No account found with that email or username." };
    email = resolved;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { ok: false, error: error.message };
  if (data.user) {
    const recovery = await recoverProfileForUser(
      data.user.id,
      trustedRoleIntentFromAppMetadata(data.user.app_metadata)
        ? data.user.app_metadata
        : undefined
    );
    if (!recovery.ok) return { ok: false, error: PROFILE_SETUP_ATTENTION_MESSAGE };
    return { ok: true };
  }
  console.error("[auth] sign-in returned no authenticated user");
  return { ok: false, error: PROFILE_SETUP_ATTENTION_MESSAGE };
}

/** Register a new account. Defaults to the panel_owner role for the Innvil app. */
export async function signUpAction(
  email: string,
  password: string,
  opts?: { displayName?: string }
): Promise<AuthResult> {
  const supabase = await createClient();
  const h = await headers();
  const signupProduct = signupProductForHost(h.get("x-forwarded-host") ?? h.get("host") ?? "");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: opts?.displayName ?? null, signup_product: signupProduct } },
  });
  if (error) return { ok: false, error: error.message };

  if (!data.user) {
    console.error("[auth] signup returned no authenticated user");
    return { ok: false, error: PROFILE_SETUP_RETRY_MESSAGE };
  }

  const outcome = publicSignupOutcome(data.user.id, Boolean(data.session), opts?.displayName);
  try {
    await setProfileRoleIntent(data.user.id, data.user.app_metadata, "panel_owner");
    // This is deliberately outside the session branch: confirmed-email signup
    // can return a user without a session, and must still get its profile.
    await ensureProfile(
      outcome.profile.id,
      outcome.profile.role,
      outcome.profile.displayName
    );
    await clearProfileRoleIntent(data.user.id, {
      ...(data.user.app_metadata ?? {}),
      profile_role_intent: outcome.profile.role,
    });
  } catch {
    return { ok: false, error: PROFILE_SETUP_RETRY_MESSAGE };
  }
  return outcome.needsConfirmation ? { ok: true, needsConfirmation: true } : { ok: true };
}

/**
 * Resolves the origin the reset-password redirect link should use, derived
 * from the ACTUAL incoming request host (never a client-supplied value) --
 * a small, explicit allowlist of exactly one alternate first-party product
 * domain, not "trust whatever the client says". A request on
 * watch.innvil.cloud gets a link back to watch.innvil.cloud/reset-password
 * (so the reset flow stays Watch-branded end to end); anything else falls
 * back to the configured canonical app URL, matching the prior behavior.
 *
 * NOTE: for this to actually work in production, `https://watch.innvil.cloud
 * /reset-password` must also be added to Supabase Auth's Redirect URLs
 * allowlist (dashboard) -- Supabase itself rejects/ignores a redirectTo that
 * isn't allowlisted there, regardless of what this function returns.
 */
async function resolveAuthRedirectOrigin(): Promise<string | undefined> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase().split(":")[0];
  if (isTrustedWatchHost(host)) {
    const proto = h.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined;
}

/** Email a password-reset link. The link lands on /reset-password to set a new one. */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const supabase = await createClient();
  const origin = await resolveAuthRedirectOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    origin ? { redirectTo: `${origin}/reset-password` } : undefined
  );
  // Don't leak whether an email exists — report success regardless of lookup.
  if (error && !/rate/i.test(error.message)) return { ok: false, error: error.message };
  return { ok: true };
}

/** Sign the current user out (clears the session cookie). */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
