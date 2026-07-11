import "server-only";
import crypto from "crypto";
import type { GatewayAdapter } from "./types";

/* =========================================================
   Razorpay (India) — hosted Payment Links + signed webhooks.
   Public: keyId. Secret: keySecret, webhookSecret.
   The owner must add a webhook in their Razorpay dashboard pointing to
   {APP_URL}/api/webhooks/razorpay for the `payment_link.paid` event, using the
   same webhook secret they enter here.
   NOTE: Razorpay charges in INR. Wallet currency handling is single-currency for
   now (see docs) — amounts are credited 1:1.
   ========================================================= */

const BASE = "https://api.razorpay.com/v1";

export const razorpayAdapter: GatewayAdapter = {
  id: "razorpay",
  label: "Razorpay",
  note: "India · UPI, cards, netbanking, wallets",
  fields: [
    { key: "keyId", label: "Key ID", secret: false, placeholder: "rzp_live_…" },
    { key: "keySecret", label: "Key Secret", secret: true },
    {
      key: "webhookSecret",
      label: "Webhook secret",
      secret: true,
      help: "In Razorpay → Settings → Webhooks, add {APP_URL}/api/webhooks/razorpay for the payment_link.paid event, and paste that webhook's secret here.",
    },
  ],

  async createCheckout(ctx) {
    const auth = Buffer.from(`${ctx.config.keyId}:${ctx.secrets.keySecret}`).toString("base64");
    const body = {
      amount: Math.round(ctx.amount * 100), // paise
      currency: "INR",
      accept_partial: false,
      reference_id: ctx.orderId,
      description: "Wallet deposit",
      ...(ctx.customerEmail ? { customer: { email: ctx.customerEmail } } : {}),
      notify: { email: !!ctx.customerEmail, sms: false },
      reminder_enable: false,
      callback_url: ctx.returnUrl,
      callback_method: "get",
    };
    const res = await fetch(`${BASE}/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as
      | { id?: string; short_url?: string; error?: { description?: string } }
      | null;
    if (!res.ok || !json?.short_url || !json?.id) {
      throw new Error(json?.error?.description || `Razorpay error (HTTP ${res.status})`);
    }
    return { url: json.short_url, ref: json.id };
  },

  extractOrderId(raw) {
    try {
      const b = JSON.parse(raw) as {
        payload?: { payment_link?: { entity?: { reference_id?: string } } };
      };
      return b.payload?.payment_link?.entity?.reference_id ?? null;
    } catch {
      return null;
    }
  },

  async verifyWebhook(ctx) {
    const signature = ctx.headers.get("x-razorpay-signature");
    if (!signature || !ctx.secrets.webhookSecret) return { paid: false };
    const expected = crypto
      .createHmac("sha256", ctx.secrets.webhookSecret)
      .update(ctx.raw)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { paid: false };

    try {
      const body = JSON.parse(ctx.raw) as {
        event?: string;
        payload?: { payment_link?: { entity?: { status?: string } } };
      };
      const status = body.payload?.payment_link?.entity?.status;
      return { paid: body.event === "payment_link.paid" || status === "paid" };
    } catch {
      return { paid: false };
    }
  },
};
