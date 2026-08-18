import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, simpleEmail } from "@/src/lib/email/resend";
import { listAccountAttentionItems } from "./watch-runtime";

/**
 * Real account-level Watch notification preferences + delivery (migration
 * 0074). Scoped to the ONE signal this codebase can compute honestly today
 * -- Needs Attention (a Community with no active Watcher, or capacity
 * nearing the plan limit) -- the same real, already-shown-on-Overview data,
 * never a fabricated event. No "failed Auto-Post"/"billing notice"
 * preference exists here: neither has a real trigger anywhere in this
 * codebase (Auto-Posting has no account-scoped backend at all).
 */

export interface NotificationPreferences {
  attentionAlertsEnabled: boolean;
}

/** Reads this account's notification preferences, lazily creating the
 *  default row (alerts on) on first read -- so a brand-new account still
 *  gets a real, persisted preference the very first time Settings loads,
 *  rather than a client-side-only default that silently isn't saved
 *  anywhere until the user happens to touch the toggle. */
export async function getNotificationPreferences(admin: SupabaseClient, accountId: string): Promise<NotificationPreferences> {
  const { data } = await admin
    .from("watch_notification_preferences")
    .select("attention_alerts_enabled")
    .eq("account_id", accountId)
    .maybeSingle();
  if (data) return { attentionAlertsEnabled: data.attention_alerts_enabled as boolean };

  await admin.from("watch_notification_preferences").upsert(
    { account_id: accountId, attention_alerts_enabled: true },
    { onConflict: "account_id" }
  );
  return { attentionAlertsEnabled: true };
}

export async function setNotificationPreferences(admin: SupabaseClient, accountId: string, attentionAlertsEnabled: boolean): Promise<void> {
  await admin.from("watch_notification_preferences").upsert(
    { account_id: accountId, attention_alerts_enabled: attentionAlertsEnabled, updated_at: new Date().toISOString() },
    { onConflict: "account_id" }
  );
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

/** Sweeps every account with alerts enabled, sends at most one digest email
 *  per account per 24h, and only when there's real, current attention data
 *  to report -- never a scheduled "all clear" email, never more than once a
 *  day regardless of how many times the cron runs. Best-effort per account
 *  (one account's email failure never blocks the sweep for the rest). */
export async function sweepAttentionNotifications(admin: SupabaseClient): Promise<{ swept: number; sent: number }> {
  const { data: prefRows } = await admin
    .from("watch_notification_preferences")
    .select("account_id, last_digest_sent_at")
    .eq("attention_alerts_enabled", true);
  const rows = (prefRows ?? []) as Array<{ account_id: string; last_digest_sent_at: string | null }>;

  let sent = 0;
  const now = Date.now();
  for (const row of rows) {
    if (row.last_digest_sent_at && now - new Date(row.last_digest_sent_at).getTime() < DIGEST_MIN_INTERVAL_MS) continue;

    const items = await listAccountAttentionItems(admin, row.account_id);
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
