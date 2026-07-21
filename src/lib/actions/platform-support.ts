"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { sendEmail, simpleEmail } from "@/src/lib/email/resend";

/* Owner → Innvil support. Owners send messages to the platform; the super admin
   reads/resolves them in /superadmin and gets an email at the configured support
   address (platform_settings.support_email) or the super-admin account email(s). */

type Result = { ok: true } | { ok: false; error: string };

export interface PlatformSupportMessage {
  id: string;
  subject: string;
  body: string;
  status: string; // open | resolved
  createdAt: string;
  ownerEmail?: string | null; // populated for the super-admin view
}

async function isSuperAdmin(): Promise<boolean> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "super_admin";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Where owner support goes: the configured support_email override, else super-admin emails. */
async function resolveSupportRecipients(admin: SupabaseClient): Promise<string[]> {
  const { data: setting } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", "support_email")
    .maybeSingle();
  const value = (setting?.value ?? {}) as Record<string, unknown>;
  const override = typeof value.email === "string" ? value.email.trim() : "";
  if (override) return [override];

  const { data: supers } = await admin.from("profiles").select("id").eq("role", "super_admin");
  const emails: string[] = [];
  for (const s of (supers as Array<{ id: string }> | null) ?? []) {
    try {
      const { data } = await admin.auth.admin.getUserById(s.id);
      const e = data.user?.email;
      if (e) emails.push(e);
    } catch {
      // ignore — best-effort
    }
  }
  return emails;
}

/** Owner sends a support message to Innvil. Stores it + emails support (best-effort). */
export async function sendOwnerSupportMessage(subject: string, body: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const s = (subject ?? "").trim();
  const b = (body ?? "").trim();
  if (!s) return { ok: false, error: "Add a subject." };
  if (!b) return { ok: false, error: "Write a message." };
  if (s.length > 200) return { ok: false, error: "Subject is too long (200 characters max)." };
  if (b.length > 5000) return { ok: false, error: "Message is too long (5000 characters max)." };

  const { error } = await admin.from("platform_support_messages").insert({
    owner_id: user.id,
    owner_email: user.email ?? null,
    subject: s,
    body: b,
  });
  if (error) return { ok: false, error: error.message };

  // Notify support — never blocks the request.
  try {
    const recipients = await resolveSupportRecipients(admin);
    if (recipients.length) {
      await sendEmail({
        to: recipients.join(","),
        subject: `[Innvil support] ${s}`,
        html: simpleEmail("New support message", [
          `From: ${escapeHtml(user.email ?? user.id)}`,
          `<strong>${escapeHtml(s)}</strong>`,
          escapeHtml(b).replace(/\n/g, "<br/>"),
        ]),
        text: `From: ${user.email ?? user.id}\nSubject: ${s}\n\n${b}`,
        replyTo: user.email ?? null,
      });
    }
  } catch {
    // best-effort email
  }
  return { ok: true };
}

/** The signed-in owner's own support messages. */
export async function listOwnerSupportMessages(): Promise<PlatformSupportMessage[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data } = await admin
    .from("platform_support_messages")
    .select("id, subject, body, status, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data as Array<{ id: string; subject: string; body: string; status: string; created_at: string }> | null) ?? [])
    .map((r) => ({ id: r.id, subject: r.subject, body: r.body, status: r.status, createdAt: r.created_at }));
}

/** Every owner support message (super admin only). */
export async function listPlatformSupportMessages(): Promise<PlatformSupportMessage[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_support_messages")
    .select("id, subject, body, status, created_at, owner_email")
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data as Array<{ id: string; subject: string; body: string; status: string; created_at: string; owner_email: string | null }> | null) ?? [])
    .map((r) => ({ id: r.id, subject: r.subject, body: r.body, status: r.status, createdAt: r.created_at, ownerEmail: r.owner_email }));
}

/** Mark a support message open/resolved (super admin only). */
export async function setPlatformSupportStatus(id: string, status: "open" | "resolved"): Promise<Result> {
  if (!(await isSuperAdmin())) return { ok: false, error: "Super admin only." };
  if (status !== "open" && status !== "resolved") return { ok: false, error: "Invalid status." };
  const admin = createAdminClient();
  const { error } = await admin.from("platform_support_messages").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
