import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, simpleEmail } from "@/src/lib/email/resend";
import { listAccountAttentionItems, type AttentionSeverity } from "./watch-runtime";

/**
 * Real account-level Watch notification preferences + delivery (migration
 * 0074, categories split out in migration 0078). Scoped to signals this
 * codebase can compute honestly today -- Needs Attention (a Community with
 * no active Watcher, usage genuinely EXCEEDING the plan's limit, or a Watcher needing
 * status attention) -- the same real, already-shown-on-Overview data, never
 * a fabricated event. Split into three categories mapping 1:1 onto
 * `listAccountAttentionItems`'s own real severity partition (high/medium/
 * low) -- never an invented taxonomy. No "failed Auto-Post"/"billing
 * notice" preference exists here: neither has a real trigger anywhere in
 * this codebase (Auto-Posting has no account-scoped backend at all).
 */

export interface NotificationPreferences {
  noActiveWatcherEnabled: boolean;
  capacityWarningEnabled: boolean;
  watcherStatusEnabled: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  noActiveWatcherEnabled: true,
  capacityWarningEnabled: true,
  watcherStatusEnabled: true,
};

/** Which preference field gates which real AttentionItem severity. */
function severityEnabled(prefs: NotificationPreferences, severity: AttentionSeverity): boolean {
  if (severity === "high") return prefs.noActiveWatcherEnabled;
  if (severity === "medium") return prefs.capacityWarningEnabled;
  return prefs.watcherStatusEnabled;
}

/** Reads this account's notification preferences, lazily creating the
 *  default row (every category on) on first read -- so a brand-new account
 *  still gets a real, persisted preference the very first time Settings
 *  loads, rather than a client-only default that isn't saved anywhere until
 *  the user touches a toggle. */
export async function getNotificationPreferences(admin: SupabaseClient, accountId: string): Promise<NotificationPreferences> {
  const { data } = await admin
    .from("watch_notification_preferences")
    .select("no_active_watcher_enabled, capacity_warning_enabled, watcher_status_enabled")
    .eq("account_id", accountId)
    .maybeSingle();
  if (data) {
    return {
      noActiveWatcherEnabled: data.no_active_watcher_enabled as boolean,
      capacityWarningEnabled: data.capacity_warning_enabled as boolean,
      watcherStatusEnabled: data.watcher_status_enabled as boolean,
    };
  }

  await admin.from("watch_notification_preferences").upsert(
    {
      account_id: accountId,
      no_active_watcher_enabled: DEFAULT_PREFERENCES.noActiveWatcherEnabled,
      capacity_warning_enabled: DEFAULT_PREFERENCES.capacityWarningEnabled,
      watcher_status_enabled: DEFAULT_PREFERENCES.watcherStatusEnabled,
    },
    { onConflict: "account_id" }
  );
  return { ...DEFAULT_PREFERENCES };
}

export async function setNotificationCategory(
  admin: SupabaseClient,
  accountId: string,
  category: "noActiveWatcher" | "capacityWarning" | "watcherStatus",
  enabled: boolean
): Promise<void> {
  const column = category === "noActiveWatcher" ? "no_active_watcher_enabled" : category === "capacityWarning" ? "capacity_warning_enabled" : "watcher_status_enabled";
  await admin.from("watch_notification_preferences").upsert(
    { account_id: accountId, [column]: enabled, updated_at: new Date().toISOString() },
    { onConflict: "account_id" }
  );
}

export type SendTestNotificationResult = { ok: true; sentTo: string } | { ok: false; error: string };

/** Sends a REAL test email through the same `sendEmail` delivery path the
 *  digest sweep uses -- not a decorative button. Bypasses the 24h/attention-
 *  item gating entirely (an explicit, on-demand action, never counted
 *  against or confused with the automatic digest). Fails honestly if
 *  RESEND_API_KEY isn't configured or the account has no resolvable email,
 *  rather than reporting a fake success. */
export async function sendTestNotificationEmail(admin: SupabaseClient, accountId: string): Promise<SendTestNotificationResult> {
  const { data: userRes } = await admin.auth.admin.getUserById(accountId);
  const email = userRes.user?.email;
  if (!email) return { ok: false, error: "No email address on this account." };
  if (!process.env.RESEND_API_KEY?.trim()) return { ok: false, error: "Email delivery isn't configured yet." };

  await sendEmail({
    to: email,
    subject: "Innvil Watch — test notification",
    html: simpleEmail("Test notification", [
      "This is a real test email from your Innvil Watch notification settings — if you got this, delivery is working.",
    ]),
    fromName: "Innvil Watch",
  });
  return { ok: true, sentTo: email };
}

const DIGEST_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function attentionDigestEmail(items: Array<{ text: string }>): { subject: string; html: string } {
  const subject = `Innvil Watch — ${items.length} item${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} attention`;
  const html = simpleEmail(
    "Needs attention",
    items.map((i) => i.text),
    { label: "Open Innvil Watch", url: "https://watch.innvil.cloud" }
  );
  return { subject, html };
}

/** Sweeps every account with at least one category enabled, sends at most
 *  one digest email per account per 24h, and only reports items whose OWN
 *  category is enabled for that account -- never a scheduled "all clear"
 *  email, never more than once a day, never an item the account explicitly
 *  muted. Best-effort per account (one account's email failure never blocks
 *  the sweep for the rest). */
export async function sweepAttentionNotifications(admin: SupabaseClient): Promise<{ swept: number; sent: number }> {
  const { data: prefRows } = await admin
    .from("watch_notification_preferences")
    .select("account_id, last_digest_sent_at, no_active_watcher_enabled, capacity_warning_enabled, watcher_status_enabled");
  const rows = (prefRows ?? []) as Array<{
    account_id: string; last_digest_sent_at: string | null;
    no_active_watcher_enabled: boolean; capacity_warning_enabled: boolean; watcher_status_enabled: boolean;
  }>;

  let sent = 0;
  const now = Date.now();
  for (const row of rows) {
    const prefs: NotificationPreferences = {
      noActiveWatcherEnabled: row.no_active_watcher_enabled,
      capacityWarningEnabled: row.capacity_warning_enabled,
      watcherStatusEnabled: row.watcher_status_enabled,
    };
    if (!prefs.noActiveWatcherEnabled && !prefs.capacityWarningEnabled && !prefs.watcherStatusEnabled) continue;
    if (row.last_digest_sent_at && now - new Date(row.last_digest_sent_at).getTime() < DIGEST_MIN_INTERVAL_MS) continue;

    const items = (await listAccountAttentionItems(admin, row.account_id)).filter((i) => severityEnabled(prefs, i.severity));
    if (items.length === 0) continue;

    const { data: userRes } = await admin.auth.admin.getUserById(row.account_id);
    const email = userRes.user?.email;
    if (!email) continue;

    const { subject, html } = attentionDigestEmail(items);
    await sendEmail({ to: email, subject, html, fromName: "Innvil Watch" });
    await admin.from("watch_notification_preferences").update({ last_digest_sent_at: new Date().toISOString() }).eq("account_id", row.account_id);
    sent += 1;
  }
  return { swept: rows.length, sent };
}
