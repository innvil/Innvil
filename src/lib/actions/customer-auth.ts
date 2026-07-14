"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { ensureProfile } from "@/src/lib/auth";
import type { CustomerAccountRow } from "@/src/types/db";

/**
 * Panel-scoped customer auth. A customer is a Supabase auth user with role
 * "customer" plus a `customer_accounts` row per panel (holds their wallet).
 * The same person can hold accounts on many panels.
 */

export type CustomerAuthResult =
  | { ok: true; needsConfirmation?: boolean }
  | { ok: false; error: string };

/** Ensure the signed-in user has a customer_account on this panel. */
async function ensureCustomerAccount(userId: string, panelId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("customer_accounts")
    .upsert(
      { panel_id: panelId, user_id: userId, status: "active" },
      { onConflict: "panel_id,user_id", ignoreDuplicates: true }
    );
}

export async function customerSignUp(
  panelId: string,
  email: string,
  password: string,
  displayName?: string,
  emailRedirectTo?: string
): Promise<CustomerAuthResult> {
  const supabase = await createStorefrontClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName ?? null },
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  });
  if (error) return { ok: false, error: error.message };

  if (data.user && data.session) {
    await ensureProfile(data.user.id, "customer", displayName);
    await ensureCustomerAccount(data.user.id, panelId);
    return { ok: true };
  }
  // Email confirmation is on — account is created on first confirmed login.
  return { ok: true, needsConfirmation: true };
}

export async function customerSignIn(
  panelId: string,
  email: string,
  password: string
): Promise<CustomerAuthResult> {
  const supabase = await createStorefrontClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  if (data.user) {
    // Keep sign-in responsive; backfill records asynchronously.
    void Promise.allSettled([
      ensureProfile(data.user.id, "customer"),
      ensureCustomerAccount(data.user.id, panelId),
    ]);
  }
  return { ok: true };
}

export async function customerSignOut(): Promise<void> {
  const supabase = await createStorefrontClient();
  await supabase.auth.signOut();
}

export async function customerForgotPassword(
  email: string,
  redirectTo: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createStorefrontClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function customerResetPassword(
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createStorefrontClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface CustomerAccountInfo {
  id: string;
  userId: string;
  username: string | null;
  email: string | null;
  balance: number;
  status: CustomerAccountRow["status"];
}

/** The signed-in user's customer account on this panel, or null. */
export async function getCustomerAccount(panelId: string): Promise<CustomerAccountInfo | null> {
  const supabase = await createStorefrontClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("customer_accounts")
    .select("id, balance, status")
    .eq("panel_id", panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  return {
    id: data.id,
    userId: user.id,
    username: (profile?.display_name as string | null) ?? (user.user_metadata?.display_name as string | null) ?? null,
    email: user.email ?? null,
    balance: Number(data.balance),
    status: data.status,
  };
}

export async function customerUpdateDisplayName(name: string): Promise<CustomerAuthResult> {
  const supabase = await createStorefrontClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: false, error: "Username must be at least 2 characters." };
  if (trimmed.length > 40) return { ok: false, error: "Username must be 40 characters or fewer." };

  const { error: authErr } = await supabase.auth.updateUser({ data: { display_name: trimmed } });
  if (authErr) return { ok: false, error: authErr.message };

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ display_name: trimmed }).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function customerUpdateEmail(
  newEmail: string,
  currentPassword: string
): Promise<CustomerAuthResult> {
  const supabase = await createStorefrontClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in" };

  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (!currentPassword) return { ok: false, error: "Enter your current password." };

  const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (reauthErr) return { ok: false, error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { ok: false, error: error.message };
  return { ok: true, needsConfirmation: true };
}

export async function customerUpdatePassword(
  currentPassword: string,
  newPassword: string
): Promise<CustomerAuthResult> {
  const supabase = await createStorefrontClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in" };
  if (!currentPassword) return { ok: false, error: "Enter your current password." };
  if (newPassword.length < 8) return { ok: false, error: "New password must be at least 8 characters." };

  const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (reauthErr) return { ok: false, error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
