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
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(ctx.raw) as Record<string, unknown>;
    } catch {
      return { paid: false };
    }

    // The HMAC signature is BEST-EFFORT only: NOWPayments signs their own JSON
    // serialization, which won't always match a re-serialized body (number/format
    // differences), so a mismatch must NOT block a real payment. The AUTHORITATIVE
    // gate is asking NOWPayments directly, with the owner's API key, whether this
    // payment is finished — an attacker can't forge a "finished" payment there.
    const sig = ctx.headers.get("x-nowpayments-sig");
    const signatureOk = verifyIpnSignature(ctx.raw, sig, ctx.secrets.ipnSecret);

    const paymentId = payload.payment_id != null ? String(payload.payment_id) : "";
    if (paymentId && ctx.secrets.apiKey) {
      try {
        const info = await npGetPaymentStatus(ctx.secrets.apiKey, paymentId);
        if (info) return { paid: isPaidStatus(info.status) };
      } catch {
        // Lookup unavailable — fall through to the signed-body check below.
      }
    }

    // Fallback (no payment_id or lookup failed): trust the body only if the
    // signature verified and the status is finished.
    const status = typeof payload.payment_status === "string" ? payload.payment_status : "";
    return { paid: signatureOk && isPaidStatus(status) };
  },
};
