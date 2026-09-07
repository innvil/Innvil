"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { hasCampaignAutomation, hasFileUpload, hasWatchedAccounts } from "@/src/lib/plans";
import { AUTOMATOR_PERIOD_DAYS, round4 } from "@/src/lib/money";
import { effectiveAutomatorPrice, baseAutomatorPrice, automatorPromoApplies, readAutomatorPricing } from "@/src/lib/automation/pricing";

/* =========================================================
   Customer-facing Automator subscription — owner-priced (default $6.99/mo, or $9.99
   on a Business+ owner tier which also unlocks file upload + watched accounts). The
   owner can override the price and run a promo (see automation/pricing.ts). The
   customer pays from their panel wallet; the charge is an 'order'-type balance change
   (no provider payout) so the full amount is the OWNER's revenue. Runs on the storefront
   session. Monthly renewal is handled by billing/automator.ts.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AutomatorSubInfo {
  /** Owner has an active tier → the automator is offered on this storefront. */
  offered: boolean;
  active: boolean;
  lapsed: boolean;
  since: string | null;
  nextChargeAt: string | null;
  /** What the customer pays now (promo applied if active). */
  price: number;
  /** The non-promo price (for strike-through display). */
  basePrice: number;
  promoActive: boolean;
  promoLabel: string | null;
  /** Business+ perks unlocked on this storefront (follow the owner's tier). */
  fileUpload: boolean;
  watchedAccounts: boolean;
  balance: number;
  canAfford: boolean;
}

async function ctx(panelId: string) {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: panel } = await admin.from("panels").select("id, status, settings").eq("id", panelId).maybeSingle();
  if (!panel) return null;
  const { data: account } = await admin
    .from("customer_accounts").select("id, balance, status").eq("user_id", user.id).eq("panel_id", panelId).maybeSingle();
  if (!account) return null;
  return { admin, panel, account };
}

export async function getAutomatorSub(panelId: string): Promise<AutomatorSubInfo | null> {
  const c = await ctx(panelId);
  if (!c) return null;
  const { data: sub } = await c.admin
    .from("automator_subscriptions")
    .select("active, lapsed, since, next_charge_at")
    .eq("panel_id", panelId).eq("customer_id", c.account.id).maybeSingle();
  const balance = Number(c.account.balance) || 0;
  const price = effectiveAutomatorPrice(c.panel.settings);
  return {
    offered: hasCampaignAutomation(c.panel.settings),
    active: sub?.active ?? false,
    lapsed: sub?.lapsed ?? false,
    since: (sub?.since as string | null) ?? null,
    nextChargeAt: (sub?.next_charge_at as string | null) ?? null,
    price,
    basePrice: baseAutomatorPrice(c.panel.settings),
    promoActive: automatorPromoApplies(c.panel.settings),
    promoLabel: readAutomatorPricing(c.panel.settings).promoLabel,
    fileUpload: hasFileUpload(c.panel.settings),
    watchedAccounts: hasWatchedAccounts(c.panel.settings),
    balance: round4(balance),
    canAfford: balance >= price,
  };
}

/** Subscribe (charges $6.99 now) or renew a lapsed sub. */
export async function subscribeAutomator(panelId: string): Promise<Result<AutomatorSubInfo>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  if (!hasCampaignAutomation(c.panel.settings)) {
    return { ok: false, error: "The automator isn't available on this panel yet — ask support to enable it." };
  }
  if (c.account.status !== "active") return { ok: false, error: "Your account can't subscribe right now." };

  const { data: existing } = await c.admin
    .from("automator_subscriptions").select("id, active, since").eq("panel_id", panelId).eq("customer_id", c.account.id).maybeSingle();
  if (existing?.active) return { ok: false, error: "You're already subscribed." };

  const price = effectiveAutomatorPrice(c.panel.settings);
  const balance = Number(c.account.balance) || 0;
  if (balance < price) {
    return { ok: false, error: `You need $${price.toFixed(2)} in your wallet. Add funds, then subscribe.` };
  }

  // Charge the wallet (owner revenue — 'order' type, no provider payout).
  const { error: chargeErr } = await c.admin.rpc("apply_balance_change", {
    p_customer: c.account.id,
    p_amount: -price,
    p_type: "order",
    p_reason: "Automator subscription",
  });
  if (chargeErr) return { ok: false, error: "Couldn't charge your wallet. Add funds and try again." };

  const now = new Date();
  const next = new Date(now.getTime() + AUTOMATOR_PERIOD_DAYS * 86400000);
  const row = {
    panel_id: panelId,
    customer_id: c.account.id,
    active: true,
    since: (existing?.since as string | null) ?? now.toISOString(),
    last_charge_at: now.toISOString(),
    next_charge_at: next.toISOString(),
    lapsed: false,
  };
  const { error } = await c.admin.from("automator_subscriptions").upsert(row, { onConflict: "panel_id,customer_id" });
  if (error) return { ok: false, error: error.message };

  const info = await getAutomatorSub(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Subscribed, but couldn't read state." };
}

/** Cancel — stays active until the paid period naturally isn't renewed (no refund). */
export async function cancelAutomator(panelId: string): Promise<Result<AutomatorSubInfo>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  const { error } = await c.admin
    .from("automator_subscriptions")
    .update({ active: false, next_charge_at: null, lapsed: false })
    .eq("panel_id", panelId).eq("customer_id", c.account.id);
  if (error) return { ok: false, error: error.message };
  const info = await getAutomatorSub(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Canceled, but couldn't read state." };
}
