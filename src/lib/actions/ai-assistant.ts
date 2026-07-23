"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import { aiComplete, aiConfigured, type AiMessage } from "@/src/lib/ai/client";
import { readSupportSub } from "@/src/lib/ai/addon";
import { AI_ADDON_PRICE, AI_ADDON_PERIOD_DAYS, round4 } from "@/src/lib/money";

/* =========================================================
   OWNER-FACING AI (two things, owner session):

   1. ownerAssistantReply — the owner's FREE assistant. Helps them run THIS panel
      (connect a provider, import/price services, go live, payments, commission…),
      grounded in Innvil how-to + the panel's live stats. Innvil-funded; no charge.

   2. get/setSupportAddon — manage the PAID customer AI support add-on ($2.99/mo
      from the panel's Innvil balance). Enabling turns on the storefront support
      chat for the panel's CUSTOMERS. The panel core stays 0% rent (opt-in).
   ========================================================= */

const MAX_HISTORY = 12;
const MAX_MSG_LEN = 1500;

type Settings = Record<string, unknown>;
function toSettings(v: unknown): Settings {
  return v && typeof v === "object" ? (v as Settings) : {};
}
function toBalance(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Resolve the signed-in owner + verify they own the panel. */
async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin
    .from("panels")
    .select("id, name, status, owner_id, settings")
    .eq("id", panelId)
    .maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/* ---------------- Paid customer-support add-on ---------------- */

export interface SupportAddonInfo {
  enabled: boolean;
  lapsed: boolean;
  price: number;
  periodDays: number;
  nextChargeAt: string | null;
  since: string | null;
  innvilBalance: number;
  configured: boolean;
}

export async function getSupportAddon(panelId: string): Promise<SupportAddonInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const settings = toSettings(ctx.panel.settings);
  const sub = readSupportSub(settings);
  return {
    enabled: sub.enabled,
    lapsed: sub.lapsed,
    price: AI_ADDON_PRICE,
    periodDays: AI_ADDON_PERIOD_DAYS,
    nextChargeAt: sub.nextChargeAt,
    since: sub.since,
    innvilBalance: toBalance(settings.innvil_balance),
    configured: aiConfigured(),
  };
}

/** Enable (charges $2.99 now from the panel's Innvil balance) or disable the
 *  storefront customer AI support add-on. */
export async function setSupportAddon(panelId: string, enable: boolean): Promise<Result<SupportAddonInfo>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const { admin, user, panel } = ctx;
  const settings = toSettings(panel.settings);
  const sub = readSupportSub(settings);
  const addons = (settings.addons && typeof settings.addons === "object" ? settings.addons : {}) as Record<string, unknown>;

  if (!enable) {
    const updated = { ...settings, addons: { ...addons, ai_support: { ...sub, enabled: false, nextChargeAt: null, lapsed: false } } };
    const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_logs").insert({ panel_id: panelId, actor_id: user.id, action: "addon.ai_support_disabled", meta: {} });
    const info = await getSupportAddon(panelId);
    return info ? { ok: true, data: info } : { ok: false, error: "Could not read state." };
  }

  const balance = toBalance(settings.innvil_balance);
  if (balance < AI_ADDON_PRICE) {
    return { ok: false, error: `You need at least $${AI_ADDON_PRICE.toFixed(2)} in this panel's Innvil balance. Top up in Billing → Add funds, then enable.` };
  }
  const now = new Date();
  const nextCharge = new Date(now.getTime() + AI_ADDON_PERIOD_DAYS * 86400000);
  const updated = {
    ...settings,
    innvil_balance: round4(balance - AI_ADDON_PRICE),
    addons: {
      ...addons,
      ai_support: {
        enabled: true,
        since: sub.since ?? now.toISOString(),
        lastChargeAt: now.toISOString(),
        nextChargeAt: nextCharge.toISOString(),
        lapsed: false,
      },
    },
  };
  const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: user.id,
    action: "addon.ai_support_charged",
    meta: { amount: AI_ADDON_PRICE, balance_after: round4(balance - AI_ADDON_PRICE), reason: "enable" },
  });
  const info = await getSupportAddon(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Could not read state." };
}

/* ---------------- Free owner assistant ---------------- */

const OWNER_KB = `
INNVIL — HOW IT WORKS (for the panel owner running this panel):
- Innvil is a no-code white-label SMM panel builder. There is NO monthly rent for a panel and no setup fee; Innvil earns a 5% commission on COMPLETED orders only (0% on canceled/refunded). That rate drops as a panel scales (roughly 4% at 1,000 completed orders/day, 3% at 2,500, 2% at 5,000, 1% at 10,000+), capped so Innvil never takes more than $100/panel/day. Commission is settled automatically from the panel's Innvil balance.
- Connect a provider: Providers & API tab → add your SMM provider's API key → Test connection → Import services (pick services, set a markup: percentage, multiplier, or fixed amount above the provider's floor price). Innvil auto-categorizes them by platform. Provider keys are encrypted and only used server-side.
- Go live: Status tab. You can set a panel Live anytime. With $0 Innvil balance it runs in preview (Inactive) — browsable but no orders — until you fund it in Billing → Add funds (first top-up $10, then $5 min). Statuses: draft (hidden), live (selling), inactive (browsable, no new orders), maintenance/suspended (offline).
- Pricing floor: you can price a service as high above the provider's cost as you like, never below it.
- Custom domain: Domain tab — connect your own domain with automatic SSL; disconnect anytime and it falls back to the included subdomain (no lock-in).
- Payments: Payments tab — connect Cryptomus or NOWPayments so your customers can deposit to their wallet; deposits credit automatically on confirmation.
- Orders sync automatically with your provider (completed/partial/canceled), and the unfilled portion of a partial/canceled order is auto-refunded to the customer. Repeat orders on the same link are caught as duplicates.
- Add-ons: Customer AI Support (an AI chat for YOUR customers on your storefront) is a paid add-on ($2.99/mo from this panel's Innvil balance) you can enable in the AI Assistant tab. This assistant you're talking to now is free.
- Customer privacy boundary: owners cannot log into customer accounts or reset customer passwords — only adjust balances.
Answer only about running this panel on Innvil. Be concise, practical, and honest; if you don't know, say so. Do not invent features, prices, or stats beyond what's stated here or in the panel data provided.
`.trim();

interface OwnerGrounding {
  panelName: string;
  status: string;
  innvilBalance: number;
  commissionRatePct: number;
  providers: number;
  servicesActive: number;
  servicesTotal: number;
  ordersToday: number;
  ordersPending: number;
  customers: number;
}

async function ownerGrounding(admin: SupabaseClient, panelId: string, panel: { name: string; status: string; settings: unknown }): Promise<OwnerGrounding> {
  const settings = toSettings(panel.settings);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [providers, servicesActive, servicesTotal, ordersToday, ordersPending, customers] = await Promise.all([
    admin.from("providers").select("id", { count: "exact", head: true }).eq("panel_id", panelId),
    admin.from("services").select("id", { count: "exact", head: true }).eq("panel_id", panelId).eq("status", "active"),
    admin.from("services").select("id", { count: "exact", head: true }).eq("panel_id", panelId),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("panel_id", panelId).gte("created_at", startOfToday.toISOString()),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("panel_id", panelId).eq("status", "pending"),
    admin.from("customer_accounts").select("id", { count: "exact", head: true }).eq("panel_id", panelId),
  ]);
  const rawRate = Number(settings.commission_rate);
  return {
    panelName: panel.name,
    status: panel.status,
    innvilBalance: toBalance(settings.innvil_balance),
    commissionRatePct: (Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 0.05) * 100,
    providers: providers.count ?? 0,
    servicesActive: servicesActive.count ?? 0,
    servicesTotal: servicesTotal.count ?? 0,
    ordersToday: ordersToday.count ?? 0,
    ordersPending: ordersPending.count ?? 0,
    customers: customers.count ?? 0,
  };
}

function buildOwnerSystem(g: OwnerGrounding): string {
  return `You are the Innvil AI Assistant for the panel owner of "${g.panelName}". Help them operate this panel.

${OWNER_KB}

THIS PANEL RIGHT NOW:
- Status: ${g.status}
- Innvil balance (funds commission + add-ons): $${g.innvilBalance.toFixed(2)}
- Commission rate: ${g.commissionRatePct.toFixed(0)}%
- Providers connected: ${g.providers}
- Services: ${g.servicesActive} active of ${g.servicesTotal} imported
- Orders today: ${g.ordersToday} (pending: ${g.ordersPending})
- Customers: ${g.customers}

Use these live numbers when relevant (e.g. if they ask why the panel isn't taking orders and the Innvil balance is $0, explain it's running in preview until funded). Keep replies short and plain — no markdown headings.`;
}

function sanitizeHistory(history: AiMessage[]): AiMessage[] {
  const clean = (history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_MSG_LEN) }))
    .slice(-MAX_HISTORY);
  while (clean.length && clean[clean.length - 1].role !== "user") clean.pop();
  return clean;
}

export type AssistantResult = { ok: true; reply: string } | { ok: false; error: string };
export type PreparedPrompt = { ok: true; system: string; messages: AiMessage[] } | { ok: false; error: string };

/** Owner-auth + grounding → the system prompt + sanitized messages. Shared by the
 *  non-streaming action and the streaming route. */
export async function prepareOwnerAssistant(panelId: string, history: AiMessage[]): Promise<PreparedPrompt> {
  const messages = sanitizeHistory(history);
  if (messages.length === 0) return { ok: false, error: "Type a message first." };
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  if (!aiConfigured()) return { ok: false, error: "AI is temporarily unavailable." };
  const g = await ownerGrounding(ctx.admin, panelId, ctx.panel);
  return { ok: true, system: buildOwnerSystem(g), messages };
}

/** The owner's free Innvil assistant (non-streaming fallback). */
export async function ownerAssistantReply(panelId: string, history: AiMessage[]): Promise<AssistantResult> {
  const prep = await prepareOwnerAssistant(panelId, history);
  if (!prep.ok) return { ok: false, error: prep.error };
  try {
    const reply = await aiComplete({ system: prep.system, messages: prep.messages, maxTokens: 600, temperature: 0.4 });
    return { ok: true, reply };
  } catch {
    return { ok: false, error: "The assistant hit an error. Try again in a moment." };
  }
}

/** Account-level assistant (not tied to one panel) for the global floating chat.
 *  Grounded in Innvil how-to + a summary of ALL the owner's panels. */
export async function prepareGlobalAssistant(history: AiMessage[]): Promise<PreparedPrompt> {
  const messages = sanitizeHistory(history);
  if (messages.length === 0) return { ok: false, error: "Type a message first." };
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Please sign in." };
  if (!aiConfigured()) return { ok: false, error: "AI is temporarily unavailable." };

  const { data } = await admin
    .from("panels")
    .select("name, status, settings")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(30);
  const panels = (data as Array<{ name: string; status: string; settings: unknown }> | null) ?? [];
  const lines = panels.map((p) => {
    const s = toSettings(p.settings);
    const bal = toBalance(s.innvil_balance);
    const rate = Number(s.commission_rate);
    const rateStr = Number.isFinite(rate) && rate > 0 ? `, commission ${(rate * 100).toFixed(0)}%` : "";
    return `- ${p.name}: status ${p.status}, Innvil balance $${bal.toFixed(2)}${rateStr}`;
  });
  const system = `You are the Innvil AI Assistant for a panel owner. Help them run their SMM panel business on Innvil.

${OWNER_KB}

THIS OWNER'S PANELS (${panels.length}):
${lines.join("\n") || "No panels created yet."}

Use these when relevant (e.g. a panel with $0 Innvil balance runs in preview until funded). If they ask about a specific panel, use the matching row above. Keep replies short and plain — no markdown headings.`;
  return { ok: true, system, messages };
}

/** Whether the owner's free assistant can be used (AI key present). */
export async function assistantConfigured(): Promise<boolean> {
  return aiConfigured();
}
