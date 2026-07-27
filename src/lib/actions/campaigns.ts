"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { placeOrder } from "@/src/lib/actions/orders";
import { analyzeCampaign, isInstagramReel } from "@/src/lib/automation/links";
import { hasCampaignAutomation, campaignLinkLimit } from "@/src/lib/plans";
import { round4 } from "@/src/lib/money";

/* =========================================================
   Campaign Automation — fan-out engine (Phase 2b).
   A customer pastes many links; for each detected platform we look up the owner's
   presets and place one order per preset via the existing placeOrder (customer
   wallet, floors + markup + provider forwarding all reused). Records campaigns +
   campaign_items. Runs on the storefront session.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface PresetRow {
  service_type: string;
  service_id: string;
  quantity: number;
}

export interface CampaignItemVM {
  link: string;
  platform: string | null;
  status: string;
  orders: number;
  charge: number;
  error?: string;
}

export interface RunCampaignResult {
  campaignId: string;
  totalLinks: number;
  ordersPlaced: number;
  totalCharge: number;
  skipped: number;
  failed: number;
  items: CampaignItemVM[];
}

export async function runCampaign(input: {
  panelId: string;
  links: string;
  tier?: "regular" | "priority";
}): Promise<Result<RunCampaignResult>> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to run a campaign." };

  const admin = createAdminClient();
  const tier = input.tier === "priority" ? "priority" : "regular";

  // Panel + gate: Campaign Automation requires a plan (comp-only until subscribe ships).
  const { data: panel } = await admin.from("panels").select("id, status, settings").eq("id", input.panelId).maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found." };
  if (!hasCampaignAutomation(panel.settings)) return { ok: false, error: "Campaign Automation isn't enabled on this panel." };
  if (panel.status !== "live") return { ok: false, error: "This panel isn't accepting orders right now." };

  // The signed-in customer on this panel.
  const { data: account } = await admin
    .from("customer_accounts")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("panel_id", input.panelId)
    .maybeSingle();
  if (!account) return { ok: false, error: "Customer account not found." };
  if (account.status !== "active") return { ok: false, error: "Your account can't place orders right now." };

  // Parse + cap by plan.
  const analysis = analyzeCampaign(input.links);
  if (analysis.total === 0) return { ok: false, error: "No valid links found. Paste one or more post links." };
  const limit = campaignLinkLimit(panel.settings);
  if (limit !== null && analysis.total > limit) {
    return { ok: false, error: `Your plan allows up to ${limit} links per campaign. You pasted ${analysis.total}.` };
  }

  // Presets for this panel, grouped by platform (this tier).
  const { data: presetRows } = await admin
    .from("campaign_service_presets")
    .select("platform, service_type, service_id, quantity")
    .eq("panel_id", input.panelId)
    .eq("tier", tier)
    .eq("enabled", true)
    .not("service_id", "is", null)
    .gt("quantity", 0);
  const presetsByPlatform = new Map<string, PresetRow[]>();
  for (const r of (presetRows as Array<{ platform: string; service_type: string; service_id: string; quantity: number }> | null) ?? []) {
    const list = presetsByPlatform.get(r.platform) ?? [];
    list.push({ service_type: r.service_type, service_id: r.service_id, quantity: r.quantity });
    presetsByPlatform.set(r.platform, list);
  }

  // Campaign header.
  const { data: campaign, error: cErr } = await admin
    .from("campaigns")
    .insert({ panel_id: input.panelId, customer_id: account.id, tier, status: "processing", total_links: analysis.total })
    .select("id")
    .single();
  if (cErr || !campaign) return { ok: false, error: cErr?.message ?? "Couldn't start the campaign." };

  const items: CampaignItemVM[] = [];
  let ordersPlaced = 0;
  let totalCharge = 0;
  let skipped = 0;
  let failed = 0;

  for (const a of analysis.links) {
    const platform = a.platform;
    if (!platform) {
      items.push({ link: a.link, platform: null, status: "skipped", orders: 0, charge: 0, error: "Unknown platform" });
      skipped++;
      continue;
    }
    let presets = presetsByPlatform.get(platform) ?? [];
    // Instagram Reel rule: only "views" services on /reel/ links.
    if (a.isReel) presets = presets.filter((p) => /view/i.test(p.service_type));
    // Comment pools land in 2c — skip comment presets for now to avoid failed orders.
    presets = presets.filter((p) => !/comment/i.test(p.service_type));

    if (presets.length === 0) {
      items.push({ link: a.link, platform, status: "skipped", orders: 0, charge: 0, error: "No matching services configured" });
      skipped++;
      continue;
    }

    let itemOrders = 0;
    let itemCharge = 0;
    let itemError: string | undefined;
    const doneServices = new Set<string>();
    const orderIds: string[] = [];

    for (const p of presets) {
      if (doneServices.has(p.service_id)) continue; // dedupe: one order per service per link
      doneServices.add(p.service_id);
      const res = await placeOrder({ panelId: input.panelId, serviceId: p.service_id, link: a.link, quantity: p.quantity });
      if (res.ok) {
        itemOrders++;
        itemCharge = round4(itemCharge + res.charge);
        orderIds.push(res.orderId);
      } else {
        itemError = res.error;
      }
    }

    const status = itemOrders === 0 ? "failed" : itemError ? "partial" : "ordered";
    if (itemOrders === 0) failed++;
    ordersPlaced += itemOrders;
    totalCharge = round4(totalCharge + itemCharge);

    await admin.from("campaign_items").insert({
      campaign_id: campaign.id, link: a.link, platform, status,
      order_ids: orderIds, charge: itemCharge, error: itemError ?? null,
    });
    items.push({ link: a.link, platform, status, orders: itemOrders, charge: itemCharge, error: itemError });
  }

  const finalStatus = ordersPlaced === 0 ? "failed" : "completed";
  await admin.from("campaigns").update({ status: finalStatus, total_charge: totalCharge }).eq("id", campaign.id);

  return {
    ok: true,
    data: { campaignId: campaign.id, totalLinks: analysis.total, ordersPlaced, totalCharge, skipped, failed, items },
  };
}

export interface CampaignVM {
  id: string;
  tier: string;
  status: string;
  totalLinks: number;
  totalCharge: number;
  createdAt: string;
}

/** The signed-in customer's recent campaigns on this panel. */
export async function listCampaigns(panelId: string, limit = 10): Promise<CampaignVM[]> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return [];
  const admin = createAdminClient();
  const { data: account } = await admin
    .from("customer_accounts").select("id").eq("user_id", user.id).eq("panel_id", panelId).maybeSingle();
  if (!account) return [];
  const { data } = await admin
    .from("campaigns")
    .select("id, tier, status, total_links, total_charge, created_at")
    .eq("customer_id", account.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data as Array<{ id: string; tier: string; status: string; total_links: number; total_charge: number; created_at: string }> | null) ?? [])
    .map((c) => ({ id: c.id, tier: c.tier, status: c.status, totalLinks: c.total_links, totalCharge: Number(c.total_charge) || 0, createdAt: c.created_at }));
}
