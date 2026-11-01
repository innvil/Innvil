"use server";

import { createClient } from "@/src/lib/supabase/server";
import { getUser } from "@/src/lib/auth";
import { createAdminClient } from "@/src/lib/supabase/admin";

/* =========================================================
   OWNER ACCOUNT SETTINGS
   Change display name (username), email, and password for the signed-in
   panel owner / staff / super admin. Email + password changes go through
   Supabase Auth; the display name is mirrored into `profiles`.
   ========================================================= */

type Result = { ok: true; message?: string } | { ok: false; error: string };

export interface AccountInfo {
  email: string | null;
  displayName: string;
  role: string;
}

/** The signed-in owner's account details for the settings screen. */
export async function getAccount(): Promise<AccountInfo | null> {
  const user = await getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, role")
    .eq("id", user.id)
    .maybeSingle();
  return {
    email: user.email ?? null,
    displayName: (profile?.display_name as string) ?? (user.user_metadata?.display_name as string) ?? "",
    role: (profile?.role as string) ?? "panel_owner",
  };
}

/** Update the display name (a.k.a. username). Mirrored to auth metadata + profiles. */
export async function updateDisplayName(name: string): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: false, error: "Username must be at least 2 characters." };
  if (trimmed.length > 40) return { ok: false, error: "Username must be 40 characters or fewer." };

  const supabase = await createClient();
  const { error: authErr } = await supabase.auth.updateUser({ data: { display_name: trimmed } });
  if (authErr) return { ok: false, error: authErr.message };

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ display_name: trimmed }).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Username updated." };
}

/**
 * Change the account email. If the project has email-confirmation on, Supabase
 * sends a confirmation link to the NEW address and the change only applies once
 * confirmed — so we report that state to the user.
 */
export async function updateEmail(newEmail: string): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (email === (user.email ?? "").toLowerCase()) return { ok: false, error: "That's already your email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Check your inbox to confirm the new email address." };
}

/** Change the account password. Requires the current password for re-authentication. */
export async function updatePassword(currentPassword: string, newPassword: string): Promise<Result> {
  const user = await getUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in" };
  if (newPassword.length < 8) return { ok: false, error: "New password must be at least 8 characters." };

  const supabase = await createClient();
  // Re-authenticate with the current password so a hijacked session can't reset it.
  const { error: reauthErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthErr) return { ok: false, error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Password changed." };
}
