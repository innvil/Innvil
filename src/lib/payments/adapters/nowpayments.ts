import "server-only";
import {
  createInvoice as npCreateInvoice,
  getPaymentStatus as npGetPaymentStatus,
  isPaidStatus,
  verifyIpnSignature,
} from "../nowpayments";
import type { GatewayAdapter } from "./types";

/* NOWPayments — crypto deposits (300+ coins). Both credentials are secret:
   - apiKey: creates invoices + status lookups (x-api-key header).
   - ipnSecret: verifies IPN webhook signatures (x-nowpayments-sig / HMAC-SHA512). */
export const nowpaymentsAdapter: GatewayAdapter = {
  id: "nowpayments",
  label: "NOWPayments",
  note: "Crypto · 300+ coins",
  fields: [
    { key: "apiKey", label: "API key", secret: true, help: "NOWPayments → Settings → Payments → API key." },
    { key: "ipnSecret", label: "IPN secret key", secret: true, help: "NOWPayments → Settings → Payments → IPN (Instant Payment Notifications) secret." },
  ],

  async createCheckout(ctx) {
    const inv = await npCreateInvoice(ctx.secrets.apiKey, {
      amount: ctx.amount.toFixed(2),
      currency: ctx.currency,
      orderId: ctx.orderId,
      callbackUrl: ctx.callbackUrl,
      returnUrl: ctx.returnUrl,
      cancelUrl: ctx.returnUrl,
    });
    return { url: inv.url, ref: inv.id };
  },

  extractOrderId(raw) {
    try {
      const body = JSON.parse(raw) as { order_id?: string };
      return typeof body.order_id === "string" ? body.order_id : null;
    } catch {
      return null;
    }
  },

  async verifyWebhook(ctx) {
    // Authoritative gate #1: HMAC signature over the raw body.
    const sig = ctx.headers.get("x-nowpayments-sig");
    if (!verifyIpnSignature(ctx.raw, sig, ctx.secrets.ipnSecret)) return { paid: false };

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(ctx.raw) as Record<string, unknown>;
    } catch {
      return { paid: false };
    }
    const status = typeof payload.payment_status === "string" ? payload.payment_status : "";
    if (!isPaidStatus(status)) return { paid: false };

    // Gate #2 (best-effort): confirm server-to-server that it's really finished.
    const paymentId = payload.payment_id != null ? String(payload.payment_id) : "";
    if (paymentId && ctx.secrets.apiKey) {
      try {
        const info = await npGetPaymentStatus(ctx.secrets.apiKey, paymentId);
        return { paid: !!info && isPaidStatus(info.status) };
      } catch {
        // Lookup failed but signature + status already validated → trust the IPN.
        return { paid: true };
      }
    }
    return { paid: true };
  },
};
