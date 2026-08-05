"use server";

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { ensureProfile } from "@/src/lib/auth";
import { readWelcomeConfig, renderWelcome } from "@/src/lib/welcome";
import { sendEmail } from "@/src/lib/email/resend";
import type { CustomerAccountRow } from "@/src/types/db";

/**
 * Panel-scoped customer auth. A customer is a Supabase auth user with role
 * "customer" plus a `customer_accounts` row per panel (holds their wallet).
 * The same person can hold accounts on many panels.
 *
 * Email verification is a CUSTOM OTP (not Supabase's project-wide confirmation email):
 * we create the user unconfirmed via the admin API (no Supabase email), email a 6-digit
 * code branded per panel (Resend), verify it here, then confirm the user — so the
 * confirmation email carries the PANEL's name, not Innvil's. Requires the Supabase
 * project "Confirm email" setting ON (so an unconfirmed user can't sign in until we
 * confirm them).
 */

const OTP_TTL_MIN = 15;
const OTP_MAX_ATTEMPTS = 5;

function genOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}
function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

/** Email a branded 6-digit code for a panel (best-effort). */
async function sendOtpEmail(admin: SupabaseClient, panelId: string, email: string, code: string): Promise<void> {
  const { data: panel } = await admin.from("panels").select("name").eq("id", panelId).maybeSingle();
  const name = (panel?.name as string) || "your panel";
  await sendEmail({
    to: email,
    fromName: name,
    subject: `${name} — your verification code is ${code}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="font-size:18px;color:#0E1522;margin:0 0 12px">Verify your ${name} account</h2>
      <p style="margin:0 0 16px;color:#3f3f46;font-size:14px;line-height:1.6">Enter this code to finish creating your account:</p>
      <p style="font-size:30px;letter-spacing:8px;font-weight:700;color:#0E1522;margin:0 0 16px">${code}</p>
      <p style="margin:0;color:#71717a;font-size:12px">This code expires in ${OTP_TTL_MIN} minutes. If you didn't request it, you can ignore this email.</p>
    </div>`,
    text: `Your ${name} verification code is ${code}. It expires in ${OTP_TTL_MIN} minutes.`,
  });
}

export type CustomerAuthResult =
  | { ok: true; needsConfirmation?: boolean; needsOtp?: boolean }
  | { ok: false; error: string };

/** Auto-open the owner's welcome ticket for a brand-new customer (best-effort). */
async function sendWelcomeTicket(admin: SupabaseClient, panelId: string, accountId: string): Promise<void> {
  const { data: panel } = await admin.from("panels").select("owner_id, name, settings").eq("id", panelId).maybeSingle();
  if (!panel) return;
  const cfg = readWelcomeConfig(panel.settings);
  if (!cfg.enabled) return;
  const currency = ((panel.settings as Record<string, unknown> | null)?.currency ?? "USD").toString().toUpperCase();
  const { subject, body } = renderWelcome(cfg, { panelName: (panel.name as string) ?? "our panel", currency });

  const now = new Date().toISOString();
  const { data: ticket } = await admin
    .from("support_tickets")
    .insert({
      panel_id: panelId, customer_id: accountId, subject,
      status: "open", kind: "welcome", last_sender: "owner",
      owner_unread: false, customer_unread: true, last_message_at: now,
    })
    .select("id")
    .maybeSingle();
  if (!ticket) return;
  await admin.from("support_ticket_messages").insert({
    ticket_id: ticket.id, sender_role: "owner", sender_id: (panel.owner_id as string) ?? null, body,
  });
}

/** Ensure the signed-in user has a customer_account on this panel. Sends the welcome
 *  ticket exactly once — only when THIS call created the account (loses a race → skip). */
async function ensureCustomerAccount(userId: string, panelId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("customer_accounts").select("id").eq("panel_id", panelId).eq("user_id", userId).maybeSingle();
  if (existing) return;

  const { data, error } = await admin
    .from("customer_accounts")
    .insert({ panel_id: panelId, user_id: userId, status: "active" })
    .select("id")
    .maybeSingle();
  if (error || !data) return; // lost the unique-constraint race → the winner sends the welcome
  await sendWelcomeTicket(admin, panelId, data.id as string).catch(() => {});
}

export async function customerSignUp(
  panelId: string,
  email: string,
  password: string,
  displayName?: string,
): Promise<CustomerAuthResult> {
  const mail = email.trim().toLowerCase();
  const admin = createAdminClient();

  // Create the user UNCONFIRMED via the admin API (this sends NO Supabase email).
  const { data, error } = await admin.auth.admin.createUser({
    email: mail,
    password,
    email_confirm: false,
    user_metadata: { display_name: displayName ?? null },
  });
  if (error || !data.user) {
    const msg = error?.message ?? "Could not create your account.";
    if (/already|registered|exists/i.test(msg)) {
      return { ok: false, error: "That email is already registered — log in instead." };
    }
    return { ok: false, error: msg };
  }
  const userId = data.user.id;
  await ensureProfile(userId, "customer", displayName);

  // Store + email a branded 6-digit code (own OTP, not Supabase's confirmation email).
  const code = genOtp();
  await admin.from("customer_signup_otps").upsert({
    email: mail, user_id: userId, panel_id: panelId,
    code_hash: hashOtp(code), expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
    attempts: 0, updated_at: new Date().toISOString(),
  }, { onConflict: "email" });
  await sendOtpEmail(admin, panelId, mail, code);

  return { ok: true, needsOtp: true };
}

/** Verify the signup OTP → confirm the user + create their account. Client then signs in. */
export async function customerVerifyOtp(panelId: string, email: string, code: string): Promise<CustomerAuthResult> {
  const mail = email.trim().toLowerCase();
  const clean = (code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("customer_signup_otps")
    .select("user_id, code_hash, expires_at, attempts")
    .eq("email", mail)
    .maybeSingle();
  if (!row) return { ok: false, error: "No pending verification — please sign up again." };
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: "That code expired. Tap resend to get a new one." };
  }
  if ((row.attempts as number) >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts. Tap resend to get a new code." };
  }
  if (hashOtp(clean) !== row.code_hash) {
    await admin.from("customer_signup_otps").update({ attempts: (row.attempts as number) + 1 }).eq("email", mail);
    return { ok: false, error: "Incorrect code. Please try again." };
  }

  const userId = row.user_id as string;
  const { error: confirmErr } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
  if (confirmErr) return { ok: false, error: "Could not confirm your account. Please try again." };

  await ensureCustomerAccount(userId, panelId);
  await admin.from("customer_signup_otps").delete().eq("email", mail);
  return { ok: true };
}

/** Resend a fresh signup OTP (rate-limited by the code TTL on the client). */
export async function customerResendOtp(panelId: string, email: string): Promise<CustomerAuthResult> {
  const mail = email.trim().toLowerCase();
  const admin = createAdminClient();
  const { data: row } = await admin.from("customer_signup_otps").select("user_id").eq("email", mail).maybeSingle();
  if (!row) return { ok: false, error: "No pending verification — please sign up again." };

  const code = genOtp();
  await admin.from("customer_signup_otps").update({
    code_hash: hashOtp(code), expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
    attempts: 0, updated_at: new Date().toISOString(),
  }).eq("email", mail);
  await sendOtpEmail(admin, panelId, mail, code);
  return { ok: true, needsOtp: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resolve a username to its login email WITHIN this panel (customers only). */
async function emailForUsername(panelId: string, username: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: accts } = await admin.from("customer_accounts").select("user_id").eq("panel_id", panelId);
  const ids = ((accts as Array<{ user_id: string }> | null) ?? []).map((a) => a.user_id);
  if (!ids.length) return null;
  const { data: profs } = await admin.from("profiles").select("id, display_name").in("id", ids);
  const uname = username.trim().toLowerCase();
  const match = ((profs as Array<{ id: string; display_name: string | null }> | null) ?? [])
    .find((p) => (p.display_name ?? "").trim().toLowerCase() === uname);
  if (!match) return null;
  try {
    const { data } = await admin.auth.admin.getUserById(match.id);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

export async function customerSignIn(
  panelId: string,
  identifier: string,
  password: string
): Promise<CustomerAuthResult> {
  const supabase = await createStorefrontClient();
  // Accept an email OR a username — resolve a username to its email on this panel.
  let email = identifier.trim();
  if (!EMAIL_RE.test(email)) {
    const resolved = await emailForUsername(panelId, email);
    if (!resolved) return { ok: false, error: "No account found with that email or username on this panel." };
    email = resolved;
  }
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
