import "server-only";
import type { GatewayAdapter, CatalogEntry } from "./types";
import { cryptomusAdapter } from "./cryptomus";
import { razorpayAdapter } from "./razorpay";
import { stripeAdapter } from "./stripe";

export * from "./types";

/** Implemented, connectable gateways. */
const ADAPTERS: Record<string, GatewayAdapter> = {
  cryptomus: cryptomusAdapter,
  razorpay: razorpayAdapter,
  stripe: stripeAdapter,
};

export function getAdapter(id: string): GatewayAdapter | null {
  return ADAPTERS[id] ?? null;
}

/**
 * The FULL menu an owner might use — not limited to what any single operator has.
 * `available: false` entries are shown in the UI as "connect coming soon" so the
 * lineup reflects the whole ecosystem (esp. India-friendly options).
 */
export const GATEWAY_CATALOG: CatalogEntry[] = [
  { id: "cryptomus", label: "Cryptomus", note: "Crypto · BTC, USDT & more", category: "crypto", available: true },
  { id: "razorpay", label: "Razorpay", note: "India · UPI, cards, netbanking", category: "card", available: true },
  { id: "stripe", label: "Stripe", note: "Global · cards, wallets (India too)", category: "card", available: true },
  { id: "paypal", label: "PayPal", note: "Global · buyer/seller protection", category: "ewallet", available: false },
  { id: "payu", label: "PayU", note: "India · cards, UPI, EMI", category: "card", available: false },
  { id: "cashfree", label: "Cashfree", note: "India · UPI, cards, payouts", category: "card", available: false },
  { id: "paytm", label: "Paytm", note: "India · wallet, UPI, cards", category: "ewallet", available: false },
  { id: "gcash", label: "GCash", note: "Philippines · e-wallet", category: "ewallet", available: false },
  { id: "maya", label: "Maya", note: "Philippines · e-wallet", category: "ewallet", available: false },
  { id: "nowpayments", label: "NOWPayments", note: "Crypto · 300+ coins", category: "crypto", available: false },
  { id: "coinbase", label: "Coinbase Commerce", note: "Crypto · BTC, ETH, USDC", category: "crypto", available: false },
];

const CATALOG_BY_ID = new Map(GATEWAY_CATALOG.map((c) => [c.id, c]));
export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG_BY_ID.get(id);
}

/** Field metadata for a connectable gateway (for the owner connect form). */
export function gatewayFields(id: string) {
  return getAdapter(id)?.fields ?? [];
}
