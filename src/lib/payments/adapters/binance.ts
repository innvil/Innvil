import "server-only";
import type { GatewayAdapter } from "./types";

/* =========================================================
   Binance Pay — personal-account reconciliation gateway.
   This is NOT a hosted-checkout adapter: there is no redirect and no webhook. The
   customer pays the owner's Pay ID and submits the transaction id, which the server
   verifies against the owner's Pay history (see actions/binance-pay.ts). This object
   exists only so the owner CONNECT form (fields + encrypted secret storage) reuses the
   same machinery as the real gateways. createCheckout/verifyWebhook are never called.
   ========================================================= */

export const binancePayAdapter: GatewayAdapter = {
  id: "binance_pay",
  label: "Binance Pay",
  note: "Crypto · pay to your Binance, verified by transaction id",
  fields: [
    { key: "payId", label: "Your Binance Pay ID", secret: false, placeholder: "123456789",
      help: "Shown to customers so they can pay you. Public — find it in Binance → Pay." },
    { key: "binanceUid", label: "Your Binance UID", secret: false, optional: true, placeholder: "e.g. 987654321",
      help: "Optional. When set, a payment is only accepted if it was received by this UID." },
    { key: "qrImage", label: "Receiving QR image URL", secret: false, optional: true, placeholder: "https://…/binance-qr.png",
      help: "Optional. A hosted image of your Binance Pay receive QR, shown on the deposit page." },
    { key: "amountPolicy", label: "Amount policy", secret: false, optional: true, placeholder: "credit_actual",
      help: "credit_actual (recommended) credits whatever was received; exact requires the exact amount (mismatches wait for your review)." },
    { key: "apiKey", label: "Binance API key", secret: true,
      help: "Create a read-only HMAC key (no trading, no withdrawals). Note: Innvil runs on serverless with no fixed IP, so an IP allowlist on the key is not reliable — keep it read-only." },
    { key: "apiSecret", label: "Binance API secret", secret: true,
      help: "Stored encrypted; never shown again. Leave blank when editing to keep the saved value." },
  ],
  async createCheckout() {
    throw new Error("Binance Pay is verified by transaction id, not a hosted checkout.");
  },
  extractOrderId() {
    return null;
  },
  async verifyWebhook() {
    return { paid: false };
  },
};
