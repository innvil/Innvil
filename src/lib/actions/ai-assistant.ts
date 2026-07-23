"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import { aiComplete, aiConfigured, type AiMessage } from "@/src/lib/ai/client";
import { readAiAssistant } from "@/src/lib/ai/addon";
import { AI_ASSISTANT_PRICE, AI_ASSISTANT_PERIOD_DAYS, round4 } from "@/src/lib/money";

/* =========================================================
   OWNER AI ASSISTANT — the paid, per-panel owner-facing helper.
   Helps the panel OWNER run THIS panel (how to connect a provider, import + price
   services, go live, read statuses, take payments, etc.), grounded in the panel's
   real stats + Innvil how-it-works knowledge. $2.99/mo billed from the panel's
   Innvil balance; the panel itself stays 0% rent (opt-in add-on).
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

export interface AssistantSubInfo {
  enabled: boolean;
  lapsed: boolean;
  price: number;
  periodDays: number;
  nextChargeAt: string | null;
  since: string | null;
  innvilBalance: number;
  configured: boolean; // AI provider key present
}

export async function getPanelAssistant(panelId: string): Promise<AssistantSubInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const settings = toSettings(ctx.panel.settings);
  const sub = readAiAssistant(settings);
  return {
    enabled: sub.enabled,
    lapsed: sub.lapsed,
    price: AI_ASSISTANT_PRICE,
    periodDays: AI_ASSISTANT_PERIOD_DAYS,
    nextChargeAt: sub.nextChargeAt,
    since: sub.since,
    innvilBalance: toBalance(settings.innvil_balance),
    configured: aiConfigured(),
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Enable (charges $2.99 now from the panel's Innvil balance) or disable the add-on. */
export async function setPanelAssistant(panelId: string, enable: boolean): Promise<Result<AssistantSubInfo>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const { admin, user, panel } = ctx;
  const settings = toSettings(panel.settings);
  const sub = readAiAssistant(settings);
  const addons = (settings.addons && typeof settings.addons === "object" ? settings.addons : {}) as Record<string, unknown>;

  if (!enable) {
    const updated = { ...settings, addons: { ...addons, ai_assistant: { ...sub, enabled: false, nextChargeAt: null, lapsed: false } } };
    const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_logs").insert({ panel_id: panelId, actor_id: user.id, action: "addon.ai_assistant_disabled", meta: {} });
    const info = await getPanelAssistant(panelId);
    return info ? { ok: true, data: info } : { ok: false, error: "Could not read state." };
  }

  // Enabling → charge the first month now.
  const balance = toBalance(settings.innvil_balance);
  if (balance < AI_ASSISTANT_PRICE) {
    return { ok: false, error: `You need at least $${AI_ASSISTANT_PRICE.toFixed(2)} in this panel's Innvil balance. Top up in Billing → Add funds, then enable.` };
  }
  const now = new Date();
  const nextCharge = new Date(now.getTime() + AI_ASSISTANT_PERIOD_DAYS * 86400000);
  const updated = {
    ...settings,
    innvil_balance: round4(balance - AI_ASSISTANT_PRICE),
    addons: {
      ...addons,
      ai_assistant: {
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
    action: "addon.ai_assistant_charged",
    meta: { amount: AI_ASSISTANT_PRICE, balance_after: round4(balance - AI_ASSISTANT_PRICE), reason: "enable" },
  });
  const info = await getPanelAssistant(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Could not read state." };
}

/* ---------------- Assistant chat ---------------- */

const OWNER_KB = `
INNVIL — HOW IT WORKS (for the panel owner running this panel):
- Innvil is a no-code white-label SMM panel builder. There is NO monthly rent for a panel and no setup fee; Innvil earns a 5% commission on COMPLETED orders only (0% on canceled/refunded). That rate drops as a panel scales (roughly 4% at 1,000 completed orders/day, 3% at 2,500, 2% at 5,000, 1% at 10,000+), capped so Innvil never takes more than $100/panel/day. Commission is settled automatically from the panel's Innvil balance.
- Connect a provider: Providers & API tab → add your SMM provider's API key → Test connection → Import services (pick services, set a markup: percentage, multiplier, or fixed amount above the provider's floor price). Innvil auto-categorizes them by platform. Provider keys are encrypted and only used server-side.
- Go live: Status tab. You can set a panel Live anytime. With $0 Innvil balance it runs in preview (Inactive) — browsable but no orders — until you fund it in Billing → Add funds (first top-up $10, then $5 min). Statuses: draft (hidden), live (selling), inactive (browsable, no new orders), maintenance/suspended (offline).
- Pricing floor: you can price a service as high above the provider's cost as you like, never below it.
- Custom domain: Domain tab — connect your own domain with automatic SSL; disconnect anytime and it falls back to the included subdomain (no lock-in).
- Payments: Payments tab — connect Cryptomus or NOWPayments so your customers can deposit to their wallet; deposits credit automatically on confirmation.
- Orders sync automatically with your provider (completed/partial/canceled), and the unfilled portion of a partial/canceled order is auto-refunded to the customer. Repeat orders on the same link are caught as duplicates.
- Add-ons: the AI Support chat (for your customers) is a separate per-panel add-on a super admin enables. This assistant you're using is the owner AI Assistant add-on.
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

export type AssistantResult = { ok: true; reply: string } | { ok: false; error: string; unavailable?: boolean };

export async function ownerAssistantReply(panelId: string, history: AiMessage[]): Promise<AssistantResult> {
  const messages = sanitizeHistory(history);
  if (messages.length === 0) return { ok: false, error: "Type a message first." };

  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  if (!readAiAssistant(toSettings(ctx.panel.settings)).enabled) {
    return { ok: false, error: "The AI Assistant add-on isn't active on this panel.", unavailable: true };
  }
  if (!aiConfigured()) return { ok: false, error: "AI is temporarily unavailable." };

  try {
    const g = await ownerGrounding(ctx.admin, panelId, ctx.panel);
    const reply = await aiComplete({ system: buildOwnerSystem(g), messages, maxTokens: 800, temperature: 0.4 });
    return { ok: true, reply };
  } catch {
    return { ok: false, error: "The assistant hit an error. Try again in a moment." };
  }
}
