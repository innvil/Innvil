"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { aiComplete, aiConfigured, getInnvilModelConfig, type AiMessage } from "@/src/lib/ai/client";
import { customerSupportActive } from "@/src/lib/ai/addon";
import { getStorefrontServices, getPanelPaymentMethods } from "@/src/lib/actions/storefront";
import { createTicket } from "@/src/lib/actions/tickets";

/* =========================================================
   AI SUPPORT — customer side (storefront session).
   Answers a signed-in customer's questions grounded in THIS panel's catalog, the
   customer's own wallet balance + recent orders, and how ordering works. Gated on
   the panel's paid AI add-on. Hard privacy rule: the model is never given (and is
   told never to reveal) provider identities, provider cost, price floors, markup,
   or Innvil commission. Escalates to a human via the existing ticket system.
   ========================================================= */

const MAX_HISTORY = 12;
const MAX_MSG_LEN = 1500;
const CATALOG_CAP = 40;

/** Built-in "how it works" FAQ. Panel-agnostic, needs no owner configuration —
 *  gives the assistant FAQ-quality answers for the common questions out of the box. */
const SUPPORT_FAQ = `
HOW THIS STORE WORKS (use this to answer common questions):
- Placing an order: go to New Order, pick a platform, then a category, then a service, paste the target link/username, enter a quantity within the service's min/max, and confirm. The price is shown before ordering and is deducted from the wallet balance.
- Adding funds: open Wallet → Add Funds, choose a payment method, and pay. Crypto deposits credit the wallet automatically once confirmed on the network.
- Order status: orders go pending → processing/in progress → completed. Some end as "partial" (only part delivered) or "canceled"; when that happens the undelivered portion is automatically refunded to the wallet balance.
- Delivery time: start time and speed depend on the specific service — tell them to check that service's estimated start/completion on the New Order page. Some services support drip-feed (spread delivery out) or refill (top-ups if counts drop) when the service says so.
- Tracking: all orders and their live status are in the Orders tab; support requests are in the Tickets tab.
- Refunds/problems: customers can't cancel or refund an order themselves here — if an order is stuck, failed, or wrong, they should open a ticket via "Talk to a human" and the store will help.
- Never promise specific delivery speeds, quality guarantees, or refund outcomes beyond what's stated above; if unsure, say so and point them to the right page or a ticket.
`.trim();

export type SupportResult =
  | { ok: true; reply: string }
  | { ok: false; error: string; unavailable?: boolean };

interface Grounding {
  panelName: string;
  currency: string;
  status: string;
  balance: number;
  services: Array<{ name: string; platform: string | null; category: string | null; price: number; min: number; max: number }>;
  moreServices: number;
  orders: Array<{ no: string; service: string; qty: number; charge: number; status: string; when: string }>;
  deposits: string[];
  ownerSections: Array<{ title: string; body: string }>;
}

/** Resolve the signed-in customer on a panel + gate + grounding. */
async function loadContext(panelId: string): Promise<
  | { ok: true; accountId: string; userId: string; g: Grounding }
  | { ok: false; error: string; unavailable?: boolean }
> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to use support." };

  const admin = createAdminClient();
  const { data: panel } = await admin
    .from("panels")
    .select("id, name, status, settings")
    .eq("id", panelId)
    .maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found.", unavailable: true };
  if (!customerSupportActive(panel.settings)) return { ok: false, error: "Support chat is unavailable on this panel.", unavailable: true };

  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, balance")
    .eq("panel_id", panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!acct) return { ok: false, error: "No account found on this panel." };

  const settings = (panel.settings ?? {}) as Record<string, unknown>;
  const currency = typeof settings.currency === "string" && settings.currency ? String(settings.currency).toUpperCase() : "USD";

  const allServices = await getStorefrontServices(panelId).catch(() => []);
  const services = allServices.slice(0, CATALOG_CAP).map((s) => ({
    name: s.name, platform: s.platform, category: s.category, price: s.price, min: s.min, max: s.max,
  }));

  const { data: orderRows } = await admin
    .from("orders")
    .select("id, local_id, quantity, charge, status, created_at, services(name)")
    .eq("customer_id", acct.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const orders = ((orderRows as Array<Record<string, unknown>> | null) ?? []).map((o) => {
    const svcRaw = o.services as { name?: string } | { name?: string }[] | null;
    const svc = Array.isArray(svcRaw) ? svcRaw[0] : svcRaw;
    return {
      no: o.local_id != null ? String(o.local_id) : String(o.id ?? "").slice(0, 8),
      service: svc?.name ?? "Service",
      qty: Number(o.quantity) || 0,
      charge: Number(o.charge) || 0,
      status: String(o.status ?? "pending"),
      when: String(o.created_at ?? "").slice(0, 10),
    };
  });

  const methods = await getPanelPaymentMethods(panelId).catch(() => []);
  const deposits = methods.map((m) => m.label);

  // Any custom landing blocks the owner wrote (settings.branding.sections) — extra,
  // owner-authored context for the assistant. Still zero required configuration.
  const branding = (settings.branding && typeof settings.branding === "object" ? settings.branding : {}) as Record<string, unknown>;
  const rawSections = Array.isArray(branding.sections) ? branding.sections : [];
  const ownerSections = rawSections.slice(0, 8).flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const body = typeof o.body === "string" ? o.body.trim() : "";
    if (!title && !body) return [];
    return [{ title, body }];
  });

  return {
    ok: true,
    accountId: acct.id as string,
    userId: user.id,
    g: {
      panelName: panel.name as string,
      currency,
      status: panel.status as string,
      balance: Number(acct.balance) || 0,
      services,
      moreServices: Math.max(0, allServices.length - services.length),
      orders,
      deposits,
      ownerSections,
    },
  };
}

function buildSystem(g: Grounding): string {
  const money = (n: number) => `${g.currency} ${n.toFixed(2)}`;
  const catalog = g.services.length
    ? g.services
        .map((s) => `- ${s.name}${s.platform ? ` (${s.platform}${s.category ? ` / ${s.category}` : ""})` : ""}: ${money(s.price)} per 1000, min ${s.min}, max ${s.max}`)
        .join("\n") + (g.moreServices > 0 ? `\n- …and ${g.moreServices} more services` : "")
    : "No services are listed yet.";
  const orders = g.orders.length
    ? g.orders.map((o) => `- Order #${o.no}: ${o.service}, qty ${o.qty}, ${money(o.charge)}, status "${o.status}" (placed ${o.when})`).join("\n")
    : "This customer has no orders yet.";
  const deposits = g.deposits.length ? g.deposits.join(", ") : "no payment methods connected yet";
  const ownerInfo = g.ownerSections.length
    ? `\n\nSTORE-SPECIFIC INFO (written by this store — prefer it when relevant):\n` +
      g.ownerSections.map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.body}`).join("\n")
    : "";

  return `You are the friendly support assistant for "${g.panelName}", a social-media-marketing (SMM) service store. Help this signed-in customer.

STRICT RULES:
- Only discuss THIS store: its services, orders, wallet/deposits, and how to use the site. Politely decline unrelated requests.
- NEVER mention or speculate about the store's suppliers/providers, wholesale/provider cost, price floors, markup, profit, or any commission. You do not have that information and must not invent it. Only ever discuss the customer-facing price.
- All prices are per 1000 units in ${g.currency}. Never quote a price that isn't in the catalog below; if unsure, say you're not certain and suggest they check the New Order page.
- You cannot perform actions (you can't place orders, add funds, cancel, or refund). Explain where to do it on the site instead (New Order, Wallet / Add Funds, Orders, Tickets).
- Use the customer's balance and orders below to answer "where's my order" / "what's my balance" questions. Refer to orders by their number.
- Be concise, warm, and plain-spoken. Short paragraphs, no markdown headings.
- If the customer is upset, asks for a human, reports a real problem you can't resolve (e.g. a stuck/failed order needing a refund), or you genuinely can't help — tell them to tap "Talk to a human" to open a support ticket with the store.

STORE STATUS: ${g.status}
CUSTOMER WALLET BALANCE: ${money(g.balance)}
DEPOSIT METHODS AVAILABLE: ${deposits}

${SUPPORT_FAQ}

CATALOG (customer prices only):
${catalog}

THIS CUSTOMER'S RECENT ORDERS:
${orders}${ownerInfo}`;
}

function sanitizeHistory(history: AiMessage[]): AiMessage[] {
  const clean = (history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_MSG_LEN) }))
    .slice(-MAX_HISTORY);
  // Must end on a user turn for the model to answer.
  while (clean.length && clean[clean.length - 1].role !== "user") clean.pop();
  return clean;
}

export type PreparedSupport =
  | { ok: true; system: string; messages: AiMessage[] }
  | { ok: false; error: string; unavailable?: boolean };

/** Customer-auth + gate + grounding → system prompt + sanitized messages. Shared by
 *  the non-streaming action and the streaming route. */
export async function prepareCustomerSupport(panelId: string, history: AiMessage[]): Promise<PreparedSupport> {
  const messages = sanitizeHistory(history);
  if (messages.length === 0) return { ok: false, error: "Type a message first." };
  const ctx = await loadContext(panelId);
  if (!ctx.ok) return ctx;
  if (!aiConfigured()) {
    return { ok: false, error: "AI support is temporarily unavailable — please tap “Talk to a human”." };
  }
  return { ok: true, system: buildSystem(ctx.g), messages };
}

/** Answer a customer support message (non-streaming fallback). */
export async function customerSupportReply(panelId: string, history: AiMessage[]): Promise<SupportResult> {
  const prep = await prepareCustomerSupport(panelId, history);
  if (!prep.ok) return prep;
  try {
    const { model, effort } = getInnvilModelConfig();
    const reply = await aiComplete({ system: prep.system, messages: prep.messages, maxTokens: 1024, model, effort, automation: "CUSTOMER_SUPPORT" });
    return { ok: true, reply };
  } catch {
    return { ok: false, error: "The assistant hit an error — please tap “Talk to a human”." };
  }
}

/** Open a support ticket from the chat, carrying the recent transcript. */
export async function escalateSupportToTicket(panelId: string, history: AiMessage[]): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const messages = (history ?? []).filter((m) => typeof m.content === "string" && m.content.trim());
  const firstUser = messages.find((m) => m.role === "user")?.content?.trim() ?? "Support request";
  const subject = firstUser.slice(0, 80);
  const transcript = messages
    .slice(-MAX_HISTORY)
    .map((m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");
  const body = `Escalated from AI chat.\n\n${transcript}`;
  const res = await createTicket(panelId, subject, body);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, id: res.data.id };
}
