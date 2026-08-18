"use server";

import { headers } from "next/headers";
import { createClient } from "@/src/lib/supabase/server";
import { ensureProfile } from "@/src/lib/auth";
import { isTrustedWatchHost } from "@/src/lib/config";
import type { UserRole } from "@/src/types/db";

type AuthResult =
  | { ok: true; needsConfirmation?: boolean }
  | { ok: false; error: string };

/** Sign in a panel owner / staff / super admin with email + password. */
export async function signInAction(
  email: string,
  password: string
): Promise<AuthResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { ok: false, error: error.message };
  if (data.user) {
    // Keep login fast; profile fallback creation can run asynchronously.
    void ensureProfile(data.user.id).catch(() => undefined);
  }
  return { ok: true };
}

/** Register a new account. Defaults to the panel_owner role for the Innvil app. */
export async function signUpAction(
  email: string,
  password: string,
  opts?: { displayName?: string; role?: UserRole }
): Promise<AuthResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: opts?.displayName ?? null } },
  });
  if (error) return { ok: false, error: error.message };

  // If email confirmation is on, there's a user but no active session yet.
  if (data.user && data.session) {
    await ensureProfile(data.user.id, opts?.role ?? "panel_owner", opts?.displayName);
    return { ok: true };
  }
  return { ok: true, needsConfirmation: true };
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
