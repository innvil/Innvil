import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { placeOrderForAccount } from "@/src/lib/orders/place";
import { fetchFeedLinks } from "@/src/lib/automation/feed";
import { detectPlatform } from "@/src/lib/automation/links";
import { readAutomationProfile, profileIsConfigured, slotsForLink } from "@/src/lib/automation/profile";
import { hasCampaignAutomation, hasWatchedAccounts, planTier, tierPlatforms } from "@/src/lib/plans";
import { round4 } from "@/src/lib/money";

/* =========================================================
   Watched-accounts cron sweep.
   For each active watched feed (on a live Business+ panel, with an active automator
   subscription + a configured profile), poll for new posts and auto-order them through
   the customer's automation profile (session-less, via placeOrderForAccount).
   ========================================================= */

const MAX_NEW_PER_RUN = 3; // cap new posts ordered per feed per sweep (runaway guard)

export interface WatchSweepResult {
  feeds: number;
  posts: number;
  orders: number;
}

interface WatchedRow {
  id: string;
  panel_id: string;
  customer_id: string;
  feed_url: string;
  last_item_url: string | null;
}

export async function sweepWatchedAccounts(): Promise<WatchSweepResult> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("watched_accounts")
    .select("id, panel_id, customer_id, feed_url, last_item_url")
    .eq("active", true);
  const rows = (data as WatchedRow[] | null) ?? [];
  if (!rows.length) return { feeds: 0, posts: 0, orders: 0 };

  // Cache per-panel gating + per-customer profile/account across this sweep.
  const panelCache = new Map<string, { status: string; settings: unknown } | null>();
  const getPanel = async (panelId: string) => {
    if (!panelCache.has(panelId)) {
      const { data: p } = await admin.from("panels").select("status, settings").eq("id", panelId).maybeSingle();
      panelCache.set(panelId, (p as { status: string; settings: unknown } | null) ?? null);
    }
    return panelCache.get(panelId) ?? null;
  };

  let posts = 0;
  let orders = 0;

  for (const wa of rows) {
    const panel = await getPanel(wa.panel_id);
    if (!panel || panel.status !== "live") continue;
    if (!hasCampaignAutomation(panel.settings) || !hasWatchedAccounts(panel.settings)) continue;

    // Active subscription + configured profile required.
    const { data: sub } = await admin.from("automator_subscriptions").select("active").eq("panel_id", wa.panel_id).eq("customer_id", wa.customer_id).maybeSingle();
    if (!sub?.active) continue;
    const { data: profileRow } = await admin.from("automation_profiles").select("config").eq("panel_id", wa.panel_id).eq("customer_id", wa.customer_id).maybeSingle();
    const profile = readAutomationProfile(profileRow?.config);
    if (!profileIsConfigured(profile)) continue;

    const { data: account } = await admin.from("customer_accounts").select("id, status, balance").eq("id", wa.customer_id).maybeSingle();
    if (!account || account.status !== "active") continue;

    // Poll the feed and work out which links are new.
    let links: string[];
    try { links = await fetchFeedLinks(wa.feed_url); } catch { await admin.from("watched_accounts").update({ last_checked_at: new Date().toISOString() }).eq("id", wa.id); continue; }
    if (!links.length) { await admin.from("watched_accounts").update({ last_checked_at: new Date().toISOString() }).eq("id", wa.id); continue; }

    let newLinks: string[];
    if (!wa.last_item_url) {
      newLinks = links.slice(0, 1); // first observation → baseline only
    } else {
      const idx = links.indexOf(wa.last_item_url);
      newLinks = idx === -1 ? links.slice(0, 1) : links.slice(0, idx);
    }
    newLinks = newLinks.slice(0, MAX_NEW_PER_RUN).reverse(); // oldest → newest

    const allowed = tierPlatforms(planTier(panel.settings)); // null = all
    let balance = Number(account.balance);
    let ranOut = false;
    const orderIds: string[] = [];
    let totalCharge = 0;

    for (const link of newLinks) {
      if (ranOut) break;
      const platform = detectPlatform(link);
      if (!platform) continue;
      if (allowed !== null && !(allowed as string[]).includes(platform)) continue;
      const slots = slotsForLink(profile, platform, link);
      if (!slots.length) continue;
      posts++;
      for (const slot of slots) {
        const res = await placeOrderForAccount(
          admin,
          { id: wa.panel_id, status: panel.status },
          { id: account.id as string, status: account.status as string, balance },
          { panelId: wa.panel_id, serviceId: slot.serviceId, link, quantity: slot.quantity }
        );
        if (res.ok) { orders++; orderIds.push(res.orderId); balance = res.balance; totalCharge = round4(totalCharge + res.charge); }
        else if (/insufficient/i.test(res.error)) { ranOut = true; break; }
      }
    }

    // Advance the baseline to the newest item so we don't re-order next run.
    await admin.from("watched_accounts").update({ last_item_url: links[0], last_checked_at: new Date().toISOString() }).eq("id", wa.id);

    // Record a campaign for traceability (best-effort).
    if (orderIds.length) {
      try {
        const { data: campaign } = await admin
          .from("campaigns")
          .insert({ panel_id: wa.panel_id, customer_id: wa.customer_id, tier: planTier(panel.settings) ?? "regular", status: "completed", total_links: newLinks.length, total_charge: totalCharge })
          .select("id")
          .single();
        if (campaign) {
          await admin.from("campaign_items").insert({ campaign_id: campaign.id, link: wa.feed_url, platform: null, status: "ordered", order_ids: orderIds, charge: totalCharge, error: null });
        }
      } catch { /* best-effort */ }
    }
  }

  return { feeds: rows.length, posts, orders };
}
