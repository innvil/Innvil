import "server-only";
import {
  createInvoice as cmCreateInvoice,
  getPaymentInfo as cmGetPaymentInfo,
  isPaidStatus,
  verifyWebhookSign,
} from "../cryptomus";
import type { GatewayAdapter } from "./types";

/* Cryptomus — crypto deposits. Public: merchantId. Secret: apiKey. */
export const cryptomusAdapter: GatewayAdapter = {
  id: "cryptomus",
  label: "Cryptomus",
  note: "Crypto · BTC, USDT, and many more",
  fields: [
    { key: "merchantId", label: "Merchant ID", secret: false, placeholder: "xxxxxxxx-xxxx-…" },
    { key: "apiKey", label: "Payment API key", secret: true, help: "Cryptomus → Merchant → API (the Payment key)." },
  ],

  async createCheckout(ctx) {
    const creds = { merchantId: ctx.config.merchantId, apiKey: ctx.secrets.apiKey };
    const inv = await cmCreateInvoice(creds, {
      amount: ctx.amount.toFixed(2),
      currency: ctx.currency,
      orderId: ctx.orderId,
      callbackUrl: ctx.callbackUrl,
      returnUrl: ctx.returnUrl,
    });
    return { url: inv.url, ref: inv.uuid };
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
    const creds = { merchantId: ctx.config.merchantId, apiKey: ctx.secrets.apiKey };
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(ctx.raw) as Record<string, unknown>;
    } catch {
      return { paid: false };
    }
    // Sign check is best-effort; the authoritative gate is the status lookup.
    verifyWebhookSign(payload, creds.apiKey);
    const orderId = typeof payload.order_id === "string" ? payload.order_id : null;
    if (!orderId) return { paid: false };
    try {
      const info = await cmGetPaymentInfo(creds, orderId);
      return { paid: !!info && isPaidStatus(info.status) };
    } catch {
      return { paid: false };
    }
  },
};
