"use server";

import { createClient } from "@/src/lib/supabase/server";
import { ensureProfile } from "@/src/lib/auth";
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
  if (data.user) await ensureProfile(data.user.id);
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

/** Email a password-reset link. The link lands on /reset-password to set a new one. */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim();
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
