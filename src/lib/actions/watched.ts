"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { hasWatchedAccounts } from "@/src/lib/plans";
import { fetchFeedLinks } from "@/src/lib/automation/feed";

/* =========================================================
   Watched accounts (Automator R5b) — customer-facing.
   The customer (on a Business+ owner panel, subscribed to the automator) registers a
   feed URL per account. The cron polls each feed and auto-orders new posts via their
   automation profile. Runs on the storefront session.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface WatchedAccountVM {
  id: string;
  label: string;
  feedUrl: string;
  active: boolean;
  lastCheckedAt: string | null;
}
export interface WatchedInfo {
  /** Owner tier includes watched accounts (Business+). */
  offered: boolean;
  /** Customer has an active automator subscription. */
  active: boolean;
  accounts: WatchedAccountVM[];
}

async function ctx(panelId: string) {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: panel } = await admin.from("panels").select("id, status, settings").eq("id", panelId).maybeSingle();
  if (!panel) return null;
  const { data: account } = await admin
    .from("customer_accounts").select("id, status").eq("user_id", user.id).eq("panel_id", panelId).maybeSingle();
  if (!account) return null;
  return { admin, panel, account };
}

function toVM(r: { id: string; label: string; feed_url: string; active: boolean; last_checked_at: string | null }): WatchedAccountVM {
  return { id: r.id, label: r.label, feedUrl: r.feed_url, active: r.active, lastCheckedAt: r.last_checked_at };
}

async function subActive(admin: ReturnType<typeof createAdminClient>, panelId: string, customerId: string): Promise<boolean> {
  const { data } = await admin.from("automator_subscriptions").select("active").eq("panel_id", panelId).eq("customer_id", customerId).maybeSingle();
  return data?.active ?? false;
}

export async function getWatchedAccounts(panelId: string): Promise<WatchedInfo | null> {
  const c = await ctx(panelId);
  if (!c) return null;
  const { data } = await c.admin
    .from("watched_accounts")
    .select("id, label, feed_url, active, last_checked_at")
    .eq("panel_id", panelId).eq("customer_id", c.account.id)
    .order("created_at", { ascending: false });
  return {
    offered: hasWatchedAccounts(c.panel.settings),
    active: await subActive(c.admin, panelId, c.account.id as string),
    accounts: ((data as Array<{ id: string; label: string; feed_url: string; active: boolean; last_checked_at: string | null }> | null) ?? []).map(toVM),
  };
}

const MAX_WATCHED = 20;

export async function addWatchedAccount(panelId: string, feedUrl: string, label: string): Promise<Result<WatchedAccountVM>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  if (!hasWatchedAccounts(c.panel.settings)) return { ok: false, error: "Watched accounts aren't available on this panel's plan." };
  if (!(await subActive(c.admin, panelId, c.account.id as string))) return { ok: false, error: "Subscribe to the automator to use watched accounts." };
  if (c.account.status !== "active") return { ok: false, error: "Your account can't do this right now." };

  const url = (feedUrl || "").trim();
  if (!url) return { ok: false, error: "Enter a feed URL." };

  const { count } = await c.admin
    .from("watched_accounts").select("id", { count: "exact", head: true }).eq("panel_id", panelId).eq("customer_id", c.account.id);
  if ((count ?? 0) >= MAX_WATCHED) return { ok: false, error: `You can watch up to ${MAX_WATCHED} accounts.` };

  // Validate the feed + set the baseline so we don't order historical posts.
  let baseline: string | null = null;
  try {
    const links = await fetchFeedLinks(url);
    baseline = links[0] ?? null;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read that feed." };
  }

  const { data, error } = await c.admin
    .from("watched_accounts")
    .insert({ panel_id: panelId, customer_id: c.account.id, label: (label || "").trim().slice(0, 80), feed_url: url, last_item_url: baseline, last_checked_at: new Date().toISOString(), active: true })
    .select("id, label, feed_url, active, last_checked_at")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't add the account." };
  return { ok: true, data: toVM(data as { id: string; label: string; feed_url: string; active: boolean; last_checked_at: string | null }) };
}

export async function setWatchedActive(panelId: string, id: string, active: boolean): Promise<Result<null>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  const { error } = await c.admin.from("watched_accounts").update({ active }).eq("id", id).eq("panel_id", panelId).eq("customer_id", c.account.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function removeWatchedAccount(panelId: string, id: string): Promise<Result<null>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  const { error } = await c.admin.from("watched_accounts").delete().eq("id", id).eq("panel_id", panelId).eq("customer_id", c.account.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
