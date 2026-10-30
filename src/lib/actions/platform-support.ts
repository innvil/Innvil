"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { sendEmail, simpleEmail } from "@/src/lib/email/resend";
import { supportEmailAlert, unreadStateForDirection, type SupportDirection } from "@/src/lib/platform-support/thread-state";

/* Innvil's panel-owner support conversations. Messages live in the panel; email
   is only a best-effort alert that a reply is waiting in Innvil. */

type Result = { ok: true } | { ok: false; error: string };

export interface PlatformSupportMessage {
  id: string;
  body: string;
  direction: SupportDirection;
  createdAt: string;
}

export interface PlatformSupportThread {
  id: string;
  subject: string;
  status: "open" | "resolved";
  lastDirection: "inbound" | "outbound";
  unread: boolean;
  lastMessageAt: string;
  ownerEmail?: string | null;
}

export interface PlatformSupportThreadDetail {
  thread: PlatformSupportThread;
  messages: PlatformSupportMessage[];
}

export interface PlatformSupportNotification {
  threadId: string;
  subject: string;
  direction: "inbound" | "outbound";
  createdAt: string;
  ownerEmail?: string | null;
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

/** Alert recipients: configured support_email, else super-admin account emails. */
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

function appUrl(path = ""): string | undefined {
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return app ? `${app}${path}` : undefined;
}

async function notifyInnvilByEmail(admin: SupabaseClient, subject: string) {
  const recipients = await resolveSupportRecipients(admin);
  if (!recipients.length) return;
  const url = appUrl("/superadmin");
  await sendEmail({
    to: recipients.join(","),
    subject: `[Innvil] New support message: ${subject}`,
    html: simpleEmail("New support message in Innvil", [supportEmailAlert("innvil")], url ? { label: "Open Innvil support", url } : undefined),
    text: supportEmailAlert("innvil"),
  });
}

async function notifyOwnerByEmail(ownerEmail: string | null, subject: string) {
  if (!ownerEmail) return;
  const url = appUrl("/");
  await sendEmail({
    to: ownerEmail,
    subject: `[Innvil] New reply: ${subject}`,
    html: simpleEmail("New reply in Innvil", [supportEmailAlert("owner")], url ? { label: "Open Innvil", url } : undefined),
    text: supportEmailAlert("owner"),
  });
}

function threadVm(row: Record<string, unknown>, viewer: "owner" | "innvil"): PlatformSupportThread {
  return {
    id: row.id as string,
    subject: row.subject as string,
    status: row.status === "resolved" ? "resolved" : "open",
    lastDirection: row.last_direction === "outbound" ? "outbound" : "inbound",
    unread: viewer === "owner" ? row.owner_unread === true : row.innvil_unread === true,
    lastMessageAt: row.last_message_at as string,
    ...(viewer === "innvil" ? { ownerEmail: (row.owner_email as string | null) ?? null } : {}),
  };
}

async function threadMessages(admin: SupabaseClient, threadId: string): Promise<PlatformSupportMessage[]> {
  const { data } = await admin
    .from("platform_support_messages")
    .select("id, body, direction, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  return ((data as Array<{ id: string; body: string; direction: string; created_at: string }> | null) ?? []).map((m) => ({
    id: m.id,
    body: m.body,
    direction: m.direction === "outbound" ? "outbound" : "inbound",
    createdAt: m.created_at,
  }));
}

async function createThreadWithMessage(admin: SupabaseClient, params: {
  ownerId: string;
  ownerEmail: string | null;
  subject: string;
  body: string;
  direction: SupportDirection;
  senderId: string | null;
  kind?: "general" | "onboarding_draft_nudge" | "onboarding_draft_followup";
}): Promise<{ id: string } | { error: string }> {
  const now = new Date().toISOString();
  const { data: thread, error: threadErr } = await admin
    .from("platform_support_threads")
    .insert({
      owner_id: params.ownerId,
      owner_email: params.ownerEmail,
      subject: params.subject,
      status: "open",
      owner_unread: unreadStateForDirection(params.direction).ownerUnread,
      innvil_unread: unreadStateForDirection(params.direction).innvilUnread,
      last_direction: params.direction,
      last_message_at: now,
    })
    .select("id")
    .maybeSingle();
  if (threadErr || !thread) return { error: threadErr?.message ?? "Could not create the support conversation." };

  const { error: messageErr } = await admin.from("platform_support_messages").insert({
    thread_id: thread.id,
    owner_id: params.ownerId,
    owner_email: params.ownerEmail,
    subject: params.subject,
    body: params.body,
    direction: params.direction,
    kind: params.kind ?? "general",
    sender_id: params.senderId,
    status: "open",
  });
  if (messageErr) {
    await admin.from("platform_support_threads").delete().eq("id", thread.id);
    return { error: messageErr.message };
  }
  return { id: thread.id as string };
}

/** Owner starts a new Innvil support conversation. Email is alert-only. */
export async function sendOwnerSupportMessage(subject: string, body: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const s = (subject ?? "").trim();
  const b = (body ?? "").trim();
  if (!s) return { ok: false, error: "Add a subject." };
  if (!b) return { ok: false, error: "Write a message." };
  if (s.length > 200) return { ok: false, error: "Subject is too long (200 characters max)." };
  if (b.length > 5000) return { ok: false, error: "Message is too long (5000 characters max)." };

  const created = await createThreadWithMessage(admin, {
    ownerId: user.id, ownerEmail: user.email ?? null, subject: s, body: b,
    direction: "inbound", senderId: user.id,
  });
  if ("error" in created) return { ok: false, error: created.error };

  // Email is an alert only; the message itself remains inside Innvil.
  try {
    await notifyInnvilByEmail(admin, s);
  } catch {
    // The in-app conversation was already stored successfully.
  }
  return { ok: true };
}

/** The signed-in owner's Innvil support conversations. */
export async function listOwnerSupportMessages(): Promise<PlatformSupportThread[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data } = await admin
    .from("platform_support_threads")
    .select("id, subject, status, owner_unread, innvil_unread, last_message_at, owner_email, last_direction")
    .eq("owner_id", user.id)
    .order("last_message_at", { ascending: false })
    .limit(50);
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((row) => threadVm(row, "owner"));
}

/** Every Innvil support conversation (super admin only). */
export async function listPlatformSupportMessages(): Promise<PlatformSupportThread[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_support_threads")
    .select("id, subject, status, owner_unread, innvil_unread, last_message_at, owner_email, last_direction")
    .order("last_message_at", { ascending: false })
    .limit(200);
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((row) => threadVm(row, "innvil"));
}

export async function getOwnerSupportThread(threadId: string): Promise<PlatformSupportThreadDetail | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data } = await admin.from("platform_support_threads")
    .select("id, subject, status, owner_unread, innvil_unread, last_message_at, owner_email, last_direction")
    .eq("id", threadId).eq("owner_id", user.id).maybeSingle();
  if (!data) return null;
  await admin.from("platform_support_threads").update({ owner_unread: false }).eq("id", threadId);
  return { thread: threadVm({ ...data, owner_unread: false }, "owner"), messages: await threadMessages(admin, threadId) };
}

export async function getPlatformSupportThread(threadId: string): Promise<PlatformSupportThreadDetail | null> {
  if (!(await isSuperAdmin())) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("platform_support_threads")
    .select("id, subject, status, owner_unread, innvil_unread, last_message_at, owner_email, last_direction")
    .eq("id", threadId).maybeSingle();
  if (!data) return null;
  await admin.from("platform_support_threads").update({ innvil_unread: false }).eq("id", threadId);
  return { thread: threadVm({ ...data, innvil_unread: false }, "innvil"), messages: await threadMessages(admin, threadId) };
}

async function appendThreadMessage(admin: SupabaseClient, params: {
  thread: { id: string; owner_id: string; owner_email: string | null; subject: string };
  body: string;
  direction: SupportDirection;
  senderId: string;
}): Promise<Result> {
  const now = new Date().toISOString();
  const { error } = await admin.from("platform_support_messages").insert({
    thread_id: params.thread.id,
    owner_id: params.thread.owner_id,
    owner_email: params.thread.owner_email,
    subject: params.thread.subject,
    body: params.body,
    direction: params.direction,
    kind: "general",
    sender_id: params.senderId,
    status: "open",
  });
  if (error) return { ok: false, error: error.message };
  const { error: threadErr } = await admin.from("platform_support_threads").update({
    status: "open",
    owner_unread: unreadStateForDirection(params.direction).ownerUnread,
    innvil_unread: unreadStateForDirection(params.direction).innvilUnread,
    last_direction: params.direction,
    last_message_at: now,
  }).eq("id", params.thread.id);
  if (threadErr) return { ok: false, error: threadErr.message };
  return { ok: true };
}

export async function ownerReplyToPlatformSupportThread(threadId: string, message: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  const body = message.trim();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!body) return { ok: false, error: "Write a reply." };
  if (body.length > 5000) return { ok: false, error: "Message is too long (5000 characters max)." };
  const { data: thread } = await admin.from("platform_support_threads")
    .select("id, owner_id, owner_email, subject").eq("id", threadId).eq("owner_id", user.id).maybeSingle();
  if (!thread) return { ok: false, error: "Conversation not found." };
  const result = await appendThreadMessage(admin, { thread, body, direction: "inbound", senderId: user.id });
  if (result.ok) {
    try { await notifyInnvilByEmail(admin, thread.subject as string); } catch { /* alert-only */ }
  }
  return result;
}

export async function superAdminReplyToPlatformSupportThread(threadId: string, message: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  const body = message.trim();
  if (!user || !(await isSuperAdmin())) return { ok: false, error: "Super admin only." };
  if (!body) return { ok: false, error: "Write a reply." };
  if (body.length > 5000) return { ok: false, error: "Message is too long (5000 characters max)." };
  const { data: thread } = await admin.from("platform_support_threads")
    .select("id, owner_id, owner_email, subject").eq("id", threadId).maybeSingle();
  if (!thread) return { ok: false, error: "Conversation not found." };
  const result = await appendThreadMessage(admin, { thread, body, direction: "outbound", senderId: user.id });
  if (result.ok) {
    try { await notifyOwnerByEmail(thread.owner_email as string | null, thread.subject as string); } catch { /* alert-only */ }
  }
  return result;
}

/** Unread support conversations for the account that opened the bell. */
export async function listPlatformSupportNotifications(): Promise<PlatformSupportNotification[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const superAdmin = await isSuperAdmin();
  let query = admin.from("platform_support_threads")
    .select("id, subject, owner_email, last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(10);
  query = superAdmin ? query.eq("innvil_unread", true) : query.eq("owner_id", user.id).eq("owner_unread", true);
  const { data } = await query;
  return ((data as Array<{ id: string; subject: string; owner_email: string | null; last_message_at: string }> | null) ?? []).map((row) => ({
    threadId: row.id,
    subject: row.subject,
    direction: superAdmin ? "inbound" : "outbound",
    createdAt: row.last_message_at,
    ...(superAdmin ? { ownerEmail: row.owner_email } : {}),
  }));
}

/** Mark a support conversation open/resolved (super admin only). */
export async function setPlatformSupportStatus(id: string, status: "open" | "resolved"): Promise<Result> {
  if (!(await isSuperAdmin())) return { ok: false, error: "Super admin only." };
  if (status !== "open" && status !== "resolved") return { ok: false, error: "Invalid status." };
  const admin = createAdminClient();
  const { error } = await admin.from("platform_support_threads").update({ status }).eq("id", id);
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
// Matches this form's own placeholder text exactly (OwnerSections.tsx /
// SuperAdminDashboard.tsx "Contact Innvil customers" card) -- an admin who
// leaves the fields blank and clicks Send gets exactly what the placeholder
// already visually implied would be sent, instead of a validation error.
const DEFAULT_OUTREACH_SUBJECT = "Need help launching your panel?";
const DEFAULT_OUTREACH_BODY = "Hi — we can guide you through setup and launch if you need help. Just reply here and the Innvil team will walk you through it.";

export async function sendSuperAdminOwnerMessage(ownerId: string, subject: string, body: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user || !(await isSuperAdmin())) return { ok: false, error: "Super admin only." };
  const id = (ownerId ?? "").trim();
  const s = (subject ?? "").trim() || DEFAULT_OUTREACH_SUBJECT;
  const b = (body ?? "").trim() || DEFAULT_OUTREACH_BODY;
  if (!id) return { ok: false, error: "Choose a customer." };
  if (s.length > 200) return { ok: false, error: "Subject is too long (200 characters max)." };
  if (b.length > 5000) return { ok: false, error: "Message is too long (5000 characters max)." };

  let ownerEmail: string | null = null;
  try {
    const { data: u } = await admin.auth.admin.getUserById(id);
    ownerEmail = u.user?.email ?? null;
  } catch {
    ownerEmail = null;
  }

  const created = await createThreadWithMessage(admin, {
    ownerId: id, ownerEmail, subject: s, body: b,
    direction: "outbound", senderId: user.id,
  });
  if ("error" in created) return { ok: false, error: created.error };

  if (ownerEmail) {
    try {
      await notifyOwnerByEmail(ownerEmail, s);
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
 *  in-app Contact support inbox only. It deliberately does not send email. */
async function sendOutreachMessage(admin: SupabaseClient, params: {
  ownerId: string;
  ownerEmail: string | null;
  subject: string;
  body: string;
  kind: "onboarding_draft_nudge" | "onboarding_draft_followup";
  senderId?: string | null;
}): Promise<boolean> {
  const result = await createThreadWithMessage(admin, {
    ownerId: params.ownerId,
    ownerEmail: params.ownerEmail,
    subject: params.subject,
    body: params.body,
    direction: "outbound",
    kind: params.kind,
    senderId: params.senderId ?? null,
  });
  return !("error" in result);
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
