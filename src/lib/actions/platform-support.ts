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
  direction: "inbound" | "outbound";
  kind: "general" | "onboarding_draft_nudge" | "onboarding_draft_followup";
  createdAt: string;
  ownerEmail?: string | null; // populated for the super-admin view
}

export interface InnvilOwnerContact {
  ownerId: string;
  email: string | null;
  panelCount: number;
  draftPanels: number;
  livePanels: number;
  lastPanelAt: string;
}

export interface DraftOnboardingSweepResult {
  ok: true;
  initialSent: number;
  followupsSent: number;
  skipped: number;
}

const ONBOARDING_FOLLOWUP_DELAY_MS = 48 * 60 * 60 * 1000;

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
    direction: "inbound",
    kind: "general",
    sender_id: user.id,
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
    .select("id, subject, body, status, created_at, direction, kind")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data as Array<{ id: string; subject: string; body: string; status: string; created_at: string; direction: string | null; kind: string | null }> | null) ?? [])
    .map((r) => ({
      id: r.id,
      subject: r.subject,
      body: r.body,
      status: r.status,
      direction: r.direction === "outbound" ? "outbound" : "inbound",
      kind:
        r.kind === "onboarding_draft_nudge"
          ? "onboarding_draft_nudge"
          : r.kind === "onboarding_draft_followup"
            ? "onboarding_draft_followup"
            : "general",
      createdAt: r.created_at,
    }));
}

/** Every owner support message (super admin only). */
export async function listPlatformSupportMessages(): Promise<PlatformSupportMessage[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_support_messages")
    .select("id, subject, body, status, created_at, owner_email, direction, kind")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data as Array<{ id: string; subject: string; body: string; status: string; created_at: string; owner_email: string | null; direction: string | null; kind: string | null }> | null) ?? [])
    .map((r) => ({
      id: r.id,
      subject: r.subject,
      body: r.body,
      status: r.status,
      direction: "inbound",
      kind:
        r.kind === "onboarding_draft_nudge"
          ? "onboarding_draft_nudge"
          : r.kind === "onboarding_draft_followup"
            ? "onboarding_draft_followup"
            : "general",
      createdAt: r.created_at,
      ownerEmail: r.owner_email,
    }));
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

/** Super admin owner-contact list: Innvil customers who already created at least one panel. */
export async function listInnvilOwnerContacts(): Promise<InnvilOwnerContact[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("panels")
    .select("owner_id, status, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error || !data) return [];

  const byOwner = new Map<string, { panelCount: number; draftPanels: number; livePanels: number; lastPanelAt: string }>();
  for (const row of data as Array<{ owner_id: string; status: string; created_at: string }>) {
    const prev = byOwner.get(row.owner_id);
    if (!prev) {
      byOwner.set(row.owner_id, {
        panelCount: 1,
        draftPanels: row.status === "draft" ? 1 : 0,
        livePanels: row.status === "live" ? 1 : 0,
        lastPanelAt: row.created_at,
      });
      continue;
    }
    prev.panelCount += 1;
    if (row.status === "draft") prev.draftPanels += 1;
    if (row.status === "live") prev.livePanels += 1;
    if (row.created_at > prev.lastPanelAt) prev.lastPanelAt = row.created_at;
  }

  const rows: InnvilOwnerContact[] = [];
  for (const [ownerId, stats] of byOwner.entries()) {
    let email: string | null = null;
    try {
      const { data: u } = await admin.auth.admin.getUserById(ownerId);
      email = u.user?.email ?? null;
    } catch {
      email = null;
    }
    rows.push({
      ownerId,
      email,
      panelCount: stats.panelCount,
      draftPanels: stats.draftPanels,
      livePanels: stats.livePanels,
      lastPanelAt: stats.lastPanelAt,
    });
  }
  rows.sort((a, b) => (a.lastPanelAt < b.lastPanelAt ? 1 : -1));
  return rows;
}

/** Super admin outbound message to an Innvil customer (panel owner). */
export async function sendSuperAdminOwnerMessage(ownerId: string, subject: string, body: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user || !(await isSuperAdmin())) return { ok: false, error: "Super admin only." };
  const id = (ownerId ?? "").trim();
  const s = (subject ?? "").trim();
  const b = (body ?? "").trim();
  if (!id) return { ok: false, error: "Choose a customer." };
  if (!s) return { ok: false, error: "Add a subject." };
  if (!b) return { ok: false, error: "Write a message." };
  if (s.length > 200) return { ok: false, error: "Subject is too long (200 characters max)." };
  if (b.length > 5000) return { ok: false, error: "Message is too long (5000 characters max)." };

  let ownerEmail: string | null = null;
  try {
    const { data: u } = await admin.auth.admin.getUserById(id);
    ownerEmail = u.user?.email ?? null;
  } catch {
    ownerEmail = null;
  }

  const { error } = await admin.from("platform_support_messages").insert({
    owner_id: id,
    owner_email: ownerEmail,
    subject: s,
    body: b,
    direction: "outbound",
    kind: "general",
    sender_id: user.id,
    status: "open",
  });
  if (error) return { ok: false, error: error.message };

  if (ownerEmail) {
    try {
      await sendEmail({
        to: ownerEmail,
        subject: `[Innvil] ${s}`,
        html: simpleEmail("Message from Innvil", [escapeHtml(b).replace(/\n/g, "<br/>")]),
        text: b,
      });
    } catch {
      // best-effort email
    }
  }

  return { ok: true };
}

type OwnerDraftProfile = {
  ownerId: string;
  ownerEmail: string | null;
  latestPanelName: string;
  latestPanelAt: string;
};

async function listUntouchedDraftOwners(admin: SupabaseClient): Promise<OwnerDraftProfile[]> {
  const { data, error } = await admin
    .from("panels")
    .select("owner_id, name, status, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error || !data) return [];

  const owners = new Map<string, { hasNonDraft: boolean; latestPanelName: string; latestPanelAt: string }>();
  for (const row of data as Array<{ owner_id: string; name: string; status: string; created_at: string }>) {
    const prev = owners.get(row.owner_id);
    if (!prev) {
      owners.set(row.owner_id, {
        hasNonDraft: row.status !== "draft",
        latestPanelName: row.name,
        latestPanelAt: row.created_at,
      });
      continue;
    }
    if (row.status !== "draft") prev.hasNonDraft = true;
    if (row.created_at > prev.latestPanelAt) {
      prev.latestPanelAt = row.created_at;
      prev.latestPanelName = row.name;
    }
  }

  const rows: OwnerDraftProfile[] = [];
  for (const [ownerId, info] of owners.entries()) {
    if (info.hasNonDraft) continue;
    let ownerEmail: string | null = null;
    try {
      const { data: u } = await admin.auth.admin.getUserById(ownerId);
      ownerEmail = u.user?.email ?? null;
    } catch {
      ownerEmail = null;
    }
    rows.push({ ownerId, ownerEmail, latestPanelName: info.latestPanelName, latestPanelAt: info.latestPanelAt });
  }
  return rows;
}

/** Delivers an automated draft-onboarding nudge/follow-up to the owner's
 *  in-app "Contact support" inbox ONLY -- per explicit product decision,
 *  this does NOT email the owner. The `platform_support_messages` insert
 *  below is the real delivery: `listOwnerSupportMessages()` (the same query
 *  behind OwnerContactSupport's "Your messages" list) reads every row for
 *  this owner_id with no `kind` filter, so an inserted row here shows up
 *  there immediately, tagged "From Innvil". Never call sendEmail() here --
 *  that's a deliberate scope boundary of THIS automated-sweep helper only;
 *  the separate manual super-admin one-off message
 *  (sendSuperAdminOwnerMessage) is an intentional human decision and keeps
 *  its own, unrelated email delivery. */
async function sendOutreachMessage(admin: SupabaseClient, params: {
  ownerId: string;
  ownerEmail: string | null;
  subject: string;
  body: string;
  kind: "onboarding_draft_nudge" | "onboarding_draft_followup";
  senderId?: string | null;
}): Promise<boolean> {
  const { error } = await admin.from("platform_support_messages").insert({
    owner_id: params.ownerId,
    owner_email: params.ownerEmail,
    subject: params.subject,
    body: params.body,
    direction: "outbound",
    kind: params.kind,
    sender_id: params.senderId ?? null,
    status: "open",
  });
  return !error;
}

/** Automatic first-panel draft outreach — one-time onboarding nudge per owner. */
export async function sendDraftOnboardingNudge(params: {
  ownerId: string;
  ownerEmail: string | null;
  panelName: string;
}): Promise<void> {
  const admin = createAdminClient();
  const ownerId = (params.ownerId ?? "").trim();
  if (!ownerId) return;

  // Send once per owner.
  const { data: existing } = await admin
    .from("platform_support_messages")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("kind", "onboarding_draft_nudge")
    .limit(1)
    .maybeSingle();
  if (existing?.id) return;

  // Only while all panels are still draft.
  const { data: nonDraft } = await admin
    .from("panels")
    .select("id")
    .eq("owner_id", ownerId)
    .neq("status", "draft")
    .limit(1)
    .maybeSingle();
  if (nonDraft?.id) return;

  const subject = "Need help launching your panel?";
  const body = [
    `Hi — we noticed your panel \"${params.panelName}\" is still in draft.`,
    "",
    "If you want, the Innvil team can help you connect payments/providers and get it live quickly.",
    "Just reply to this message with what you need and we will guide you.",
  ].join("\n");

  await sendOutreachMessage(admin, {
    ownerId,
    ownerEmail: params.ownerEmail,
    subject,
    body,
    kind: "onboarding_draft_nudge",
  });
}

/** One-click + cron-ready sweep: send initial nudges and due follow-ups for untouched draft-only owners. */
async function runDraftOnboardingSweepInternal(senderId?: string | null): Promise<DraftOnboardingSweepResult> {
  const admin = createAdminClient();
  const owners = await listUntouchedDraftOwners(admin);

  let initialSent = 0;
  let followupsSent = 0;
  let skipped = 0;

  for (const owner of owners) {
    const { data: history } = await admin
      .from("platform_support_messages")
      .select("kind, created_at")
      .eq("owner_id", owner.ownerId)
      .eq("direction", "outbound")
      .in("kind", ["onboarding_draft_nudge", "onboarding_draft_followup"])
      .order("created_at", { ascending: true });

    const rows = (history as Array<{ kind: string; created_at: string }> | null) ?? [];
    const firstNudge = rows.find((r) => r.kind === "onboarding_draft_nudge") ?? null;
    const hasFollowup = rows.some((r) => r.kind === "onboarding_draft_followup");

    if (!firstNudge) {
      const ok = await sendOutreachMessage(admin, {
        ownerId: owner.ownerId,
        ownerEmail: owner.ownerEmail,
        subject: "Need help launching your panel?",
        body: [
          `Hi — your panel \"${owner.latestPanelName}\" is still in draft.`,
          "",
          "If you want, the Innvil team can guide you through setup and launch.",
          "Reply here and we will help you get it live.",
        ].join("\n"),
        kind: "onboarding_draft_nudge",
        senderId: senderId ?? null,
      });
      if (ok) initialSent += 1;
      else skipped += 1;
      continue;
    }

    if (hasFollowup) {
      skipped += 1;
      continue;
    }

    const firstAt = new Date(firstNudge.created_at).getTime();
    if (!Number.isFinite(firstAt) || Date.now() - firstAt < ONBOARDING_FOLLOWUP_DELAY_MS) {
      skipped += 1;
      continue;
    }

    const ok = await sendOutreachMessage(admin, {
      ownerId: owner.ownerId,
      ownerEmail: owner.ownerEmail,
      subject: "Quick follow-up: want help launching your panel?",
      body: [
        `Just following up on your draft panel \"${owner.latestPanelName}\".`,
        "",
        "If you still need help, reply here and the Innvil team will guide you step by step.",
      ].join("\n"),
      kind: "onboarding_draft_followup",
      senderId: senderId ?? null,
    });
    if (ok) followupsSent += 1;
    else skipped += 1;
  }

  return { ok: true, initialSent, followupsSent, skipped };
}

/** One-click super-admin action from UI. */
export async function runDraftOnboardingSweep(): Promise<DraftOnboardingSweepResult> {
  const { user } = await getAuthedAdmin();
  if (!user || !(await isSuperAdmin())) {
    return { ok: true, initialSent: 0, followupsSent: 0, skipped: 0 };
  }
  return runDraftOnboardingSweepInternal(user.id);
}

/** Cron-only variant (server-side scheduled runs, no interactive auth session). */
export async function runDraftOnboardingSweepCron(): Promise<DraftOnboardingSweepResult> {
  return runDraftOnboardingSweepInternal(null);
}
