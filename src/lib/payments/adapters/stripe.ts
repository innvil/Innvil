import "server-only";
import crypto from "crypto";
import type { GatewayAdapter } from "./types";

/* =========================================================
   Stripe (global) — hosted Checkout Session + signed webhooks.
   Public: (none required). Secret: secretKey, webhookSecret.
   The owner adds an endpoint in Stripe → Developers → Webhooks at
   {APP_URL}/api/webhooks/stripe for `checkout.session.completed`, and pastes the
   signing secret (whsec_…) here.
   ========================================================= */

const BASE = "https://api.stripe.com/v1";

export const stripeAdapter: GatewayAdapter = {
  id: "stripe",
  label: "Stripe",
  note: "Global · cards, wallets (works in India too)",
  fields: [
    { key: "secretKey", label: "Secret key", secret: true, placeholder: "sk_live_…" },
    {
      key: "webhookSecret",
      label: "Webhook signing secret",
      secret: true,
      placeholder: "whsec_…",
      help: "Stripe → Developers → Webhooks: add {APP_URL}/api/webhooks/stripe for checkout.session.completed, then paste its signing secret.",
    },
  ],

  async createCheckout(ctx) {
    const p = new URLSearchParams();
    p.set("mode", "payment");
    p.set("success_url", ctx.returnUrl);
    p.set("cancel_url", ctx.returnUrl);
    p.set("client_reference_id", ctx.orderId);
    p.set("metadata[orderId]", ctx.orderId);
    if (ctx.customerEmail) p.set("customer_email", ctx.customerEmail);
    p.set("line_items[0][quantity]", "1");
    p.set("line_items[0][price_data][currency]", ctx.currency.toLowerCase());
    p.set("line_items[0][price_data][unit_amount]", String(Math.round(ctx.amount * 100)));
    p.set("line_items[0][price_data][product_data][name]", "Wallet deposit");

    const res = await fetch(`${BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.secrets.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: p.toString(),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as
      | { id?: string; url?: string; error?: { message?: string } }
      | null;
    if (!res.ok || !json?.url || !json?.id) {
      throw new Error(json?.error?.message || `Stripe error (HTTP ${res.status})`);
    }
    return { url: json.url, ref: json.id };
  },

  extractOrderId(raw) {
    try {
      const b = JSON.parse(raw) as {
        data?: { object?: { client_reference_id?: string; metadata?: { orderId?: string } } };
      };
      return b.data?.object?.client_reference_id ?? b.data?.object?.metadata?.orderId ?? null;
    } catch {
      return null;
    }
  },

  async verifyWebhook(ctx) {
    const sig = ctx.headers.get("stripe-signature");
    const secret = ctx.secrets.webhookSecret;
    if (!sig || !secret) return { paid: false };

    // Header: "t=<ts>,v1=<hex>,v1=<hex>…"
    let t = "";
    const v1: string[] = [];
    for (const part of sig.split(",")) {
      const [k, val] = part.split("=");
      if (k === "t") t = val;
      else if (k === "v1" && val) v1.push(val);
    }
    if (!t || v1.length === 0) return { paid: false };

    const expected = crypto.createHmac("sha256", secret).update(`${t}.${ctx.raw}`).digest("hex");
    const exp = Buffer.from(expected);
    const ok = v1.some((v) => {
      const b = Buffer.from(v);
      return b.length === exp.length && crypto.timingSafeEqual(b, exp);
    });
    if (!ok) return { paid: false };

    try {
      const body = JSON.parse(ctx.raw) as {
        type?: string;
        data?: { object?: { payment_status?: string } };
      };
      return {
        paid:
          body.type === "checkout.session.completed" &&
          body.data?.object?.payment_status === "paid",
      };
    } catch {
      return { paid: false };
    }
  },
};
