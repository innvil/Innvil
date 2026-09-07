"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { placeOrder } from "@/src/lib/actions/orders";
import { analyzeCampaign, parseCampaignLinks } from "@/src/lib/automation/links";
import { hasCampaignAutomation, campaignLinkLimit, planTier, tierPlatforms } from "@/src/lib/plans";
import { readAutomationProfile, profileIsConfigured, slotsForLink } from "@/src/lib/automation/profile";
import { round4 } from "@/src/lib/money";
import { placeOrderForAccount } from "@/src/lib/orders/place";

/* =========================================================
   Campaign Automation — fan-out engine (Phase 2b).
   A customer pastes many links; for each detected platform we look up the owner's
   presets and place one order per preset via the existing placeOrder (customer
   wallet, floors + markup + provider forwarding all reused). Records campaigns +
   campaign_items. Runs on the storefront session.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

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
}): Promise<Result<RunCampaignResult>> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to run a campaign." };

  const admin = createAdminClient();

  // Panel + gate: the owner must offer the automator (an active tier).
  const { data: panel } = await admin.from("panels").select("id, status, settings").eq("id", input.panelId).maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found." };
  if (!hasCampaignAutomation(panel.settings)) return { ok: false, error: "The automator isn't available on this panel yet." };
  if (panel.status !== "live") return { ok: false, error: "This panel isn't accepting orders right now." };

  // The signed-in customer on this panel.
  const { data: account } = await admin
    .from("customer_accounts").select("id, status").eq("user_id", user.id).eq("panel_id", input.panelId).maybeSingle();
  if (!account) return { ok: false, error: "Customer account not found." };
  if (account.status !== "active") return { ok: false, error: "Your account can't place orders right now." };

  // The customer must be subscribed to the automator.
  const { data: sub } = await admin
    .from("automator_subscriptions").select("active").eq("panel_id", input.panelId).eq("customer_id", account.id).maybeSingle();
  if (!sub?.active) return { ok: false, error: "Subscribe to the automator to run campaigns." };

  // The customer's keyword-slot configuration.
  const { data: profileRow } = await admin
    .from("automation_profiles").select("config").eq("panel_id", input.panelId).eq("customer_id", account.id).maybeSingle();
  const profile = readAutomationProfile(profileRow?.config);
  if (!profileIsConfigured(profile)) {
    return { ok: false, error: "Set up your services first — tap Configure to choose what to order." };
  }

  const allowed = tierPlatforms(planTier(panel.settings)); // null = all owner platforms

  const analysis = analyzeCampaign(input.links);
  if (analysis.total === 0) return { ok: false, error: "No valid links found. Paste one or more post links." };
  const limit = campaignLinkLimit(panel.settings);
  if (Number.isFinite(limit) && analysis.total > limit) {
    return { ok: false, error: `Your plan allows up to ${limit} links per campaign. You pasted ${analysis.total}.` };
  }

  const { data: campaign, error: cErr } = await admin
    .from("campaigns")
    .insert({ panel_id: input.panelId, customer_id: account.id, tier: planTier(panel.settings) ?? "regular", status: "processing", total_links: analysis.total })
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
    // Enforce the owner tier's platform scope.
    if (allowed !== null && !(allowed as string[]).includes(platform)) {
      items.push({ link: a.link, platform, status: "skipped", orders: 0, charge: 0, error: "Not in the panel's plan" });
      skipped++;
      continue;
    }
    // Keyword routing: the customer's matching slots (or keyword-less defaults), deduped.
    const slots = slotsForLink(profile, platform, a.link);
    if (slots.length === 0) {
      items.push({ link: a.link, platform, status: "skipped", orders: 0, charge: 0, error: "No services set up for this platform" });
      skipped++;
      continue;
    }

    let itemOrders = 0;
    let itemCharge = 0;
    let itemError: string | undefined;
    const orderIds: string[] = [];

    for (const slot of slots) {
      const res = await placeOrder({ panelId: input.panelId, serviceId: slot.serviceId, link: a.link, quantity: slot.quantity });
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

/* ----------------------------------------------------------- mass order ---- */

export interface MassOrderItemVM {
  index: number;
  target: string;
  serviceId: string;
  serviceNo: number | null;
  serviceName: string;
  quantity: number;
  ok: boolean;
  orderId?: string;
  charge?: number;
  error?: string;
}

export interface MassOrderSelectedServiceInput {
  serviceRef: string; // service UUID or panel local_id
  quantity: number;
}

export interface MassOrderResult {
  totalIntended: number;
  validTargets: number;
  selectedServices: number;
  placed: number;
  totalCharge: number;
  failed: number;
  items: MassOrderItemVM[];
}

/** Manual mass order — FREE for any customer (no automator subscription). One line per
 *  order, `serviceId | link | quantity` (pipe or space separated). serviceId is the
 *  service's own number (local id) or its uuid. */
export async function runMassOrder(input: {
  panelId: string;
  text?: string;
  targetsText?: string;
  selectedServices?: MassOrderSelectedServiceInput[];
}): Promise<Result<MassOrderResult>> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in." };

  const admin = createAdminClient();
  const { data: panel } = await admin.from("panels").select("id, status").eq("id", input.panelId).maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found." };
  if (panel.status !== "live") return { ok: false, error: "This panel isn't accepting orders right now." };

  const { data: account } = await admin
    .from("customer_accounts").select("id, status, balance").eq("user_id", user.id).eq("panel_id", input.panelId).maybeSingle();
  if (!account) return { ok: false, error: "Customer account not found." };
  if (account.status !== "active") return { ok: false, error: "Your account can't place orders right now." };

  // Resolve services: accept the panel's own service number (local_id) or the uuid.
  const { data: services } = await admin
    .from("services")
    .select("id, local_id, name, min, max, sell_rate")
    .eq("panel_id", input.panelId)
    .eq("status", "active");

  const svcRows = (services as Array<{
    id: string;
    local_id: number | null;
    name: string;
    min: number;
    max: number;
    sell_rate: number;
  }> | null) ?? [];
  const byId = new Map<string, (typeof svcRows)[number]>();
  const byLocal = new Map<string, (typeof svcRows)[number]>();
  for (const s of svcRows) {
    byId.set(s.id, s);
    if (s.local_id != null) byLocal.set(String(s.local_id), s);
  }

  const selected = (input as {
    selectedServices?: MassOrderSelectedServiceInput[];
  }).selectedServices;
  const targetsText = (input as { targetsText?: string }).targetsText;

  // New flow: selected services + one shared target input.
  if (Array.isArray(selected) && typeof targetsText === "string") {
    if (selected.length === 0) return { ok: false, error: "Add at least one service." };

    const validTargets = parseCampaignLinks(targetsText);
    if (validTargets.length === 0) return { ok: false, error: "Paste at least one valid target link." };

    // Resolve selected services in the same order the UI sends them.
    const resolved: Array<{
      serviceId: string;
      serviceNo: number | null;
      serviceName: string;
      min: number;
      max: number;
      sellRate: number;
      quantity: number;
    }> = [];
    const seen = new Set<string>();
    for (const row of selected) {
      const ref = String(row.serviceRef ?? "").trim();
      if (!ref) continue;
      const svc = byId.get(ref) ?? byLocal.get(ref) ?? null;
      if (!svc) continue;
      if (seen.has(svc.id)) continue; // guard duplicate selected service refs
      seen.add(svc.id);
      resolved.push({
        serviceId: svc.id,
        serviceNo: svc.local_id,
        serviceName: svc.name,
        min: Number(svc.min),
        max: Number(svc.max),
        sellRate: Number(svc.sell_rate),
        quantity: Math.floor(Number(row.quantity)),
      });
    }
    if (resolved.length === 0) return { ok: false, error: "No valid selected services were found." };

    const items: MassOrderItemVM[] = [];
    let placed = 0;
    let failed = 0;
    let totalCharge = 0;
    let index = 0;
    let balanceHint = Number(account.balance);

    // Deterministic attempt order: each target, then each selected service.
    for (const target of validTargets) {
      for (const svc of resolved) {
        index += 1;
        if (!Number.isFinite(svc.quantity) || svc.quantity <= 0) {
          failed++;
          items.push({
            index,
            target,
            serviceId: svc.serviceId,
            serviceNo: svc.serviceNo,
            serviceName: svc.serviceName,
            quantity: svc.quantity,
            ok: false,
            error: "Quantity must be greater than 0",
          });
          continue;
        }
        if (svc.quantity < svc.min || svc.quantity > svc.max) {
          failed++;
          items.push({
            index,
            target,
            serviceId: svc.serviceId,
            serviceNo: svc.serviceNo,
            serviceName: svc.serviceName,
            quantity: svc.quantity,
            ok: false,
            error: `Quantity must be between ${svc.min.toLocaleString()} and ${svc.max.toLocaleString()}.`,
          });
          continue;
        }

        const res = await placeOrderForAccount(
          admin,
          { id: panel.id as string, status: panel.status as string },
          { id: account.id as string, status: account.status as string, balance: balanceHint },
          { panelId: input.panelId, serviceId: svc.serviceId, link: target, quantity: svc.quantity }
        );

        if (res.ok) {
          balanceHint = res.balance;
          placed++;
          totalCharge = round4(totalCharge + res.charge);
          items.push({
            index,
            target,
            serviceId: svc.serviceId,
            serviceNo: svc.serviceNo,
            serviceName: svc.serviceName,
            quantity: svc.quantity,
            ok: true,
            orderId: res.orderId,
            charge: res.charge,
          });
        } else {
          failed++;
          items.push({
            index,
            target,
            serviceId: svc.serviceId,
            serviceNo: svc.serviceNo,
            serviceName: svc.serviceName,
            quantity: svc.quantity,
            ok: false,
            error: res.error,
          });
        }
      }
    }

    return {
      ok: true,
      data: {
        totalIntended: validTargets.length * resolved.length,
        validTargets: validTargets.length,
        selectedServices: resolved.length,
        placed,
        totalCharge,
        failed,
        items,
      },
    };
  }

  // Legacy flow: one line per order (`serviceId | link | quantity`).
  const lines = (input.text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, error: "Paste at least one line: serviceId | link | quantity." };

  const items: MassOrderItemVM[] = [];
  let placed = 0;
  let failed = 0;
  let totalCharge = 0;
  let index = 0;

  for (const raw of lines) {
    index += 1;
    const parts = raw.includes("|") ? raw.split("|").map((p) => p.trim()) : raw.split(/\s+/);
    if (parts.length < 3) {
      items.push({
        index,
        target: "",
        serviceId: "",
        serviceNo: null,
        serviceName: "",
        quantity: 0,
        ok: false,
        error: "Use: serviceId | link | quantity",
      });
      failed++;
      continue;
    }
    const ref = parts[0];
    const quantity = Number(parts[parts.length - 1]);
    const link = parts.slice(1, parts.length - 1).join(" ");
    const svc = byId.get(ref) ?? byLocal.get(ref) ?? null;
    if (!svc) {
      items.push({
        index,
        target: link,
        serviceId: ref,
        serviceNo: null,
        serviceName: "",
        quantity,
        ok: false,
        error: `No service "${ref}"`,
      });
      failed++;
      continue;
    }
    if (!link || !Number.isFinite(quantity) || quantity <= 0) {
      items.push({
        index,
        target: link,
        serviceId: svc.id,
        serviceNo: svc.local_id,
        serviceName: svc.name,
        quantity,
        ok: false,
        error: "Missing link or quantity",
      });
      failed++;
      continue;
    }

    const res = await placeOrder({ panelId: input.panelId, serviceId: svc.id, link, quantity });
    if (res.ok) {
      placed++;
      totalCharge = round4(totalCharge + res.charge);
      items.push({
        index,
        target: link,
        serviceId: svc.id,
        serviceNo: svc.local_id,
        serviceName: svc.name,
        quantity,
        ok: true,
        orderId: res.orderId,
        charge: res.charge,
      });
    } else {
      failed++;
      items.push({
        index,
        target: link,
        serviceId: svc.id,
        serviceNo: svc.local_id,
        serviceName: svc.name,
        quantity,
        ok: false,
        error: res.error,
      });
    }
  }

  return {
    ok: true,
    data: {
      totalIntended: lines.length,
      validTargets: lines.length,
      selectedServices: 0,
      placed,
      totalCharge,
      failed,
      items,
    },
  };
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
