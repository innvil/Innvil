import "server-only";

/* =========================================================
   Payment gateway adapter contract.
   Every gateway (Cryptomus, Razorpay, Stripe, …) implements this so the rest of
   the app is gateway-agnostic. Public fields (merchant/key ids, mode) are stored
   in `panel_payment_gateways.config`; secret fields are stored ENCRYPTED as a JSON
   blob in `api_key_enc` (reusing the pgcrypto set/get RPCs). Nothing here ever
   reaches the browser.
   ========================================================= */

/** A credential field shown on the owner's connect form. */
export interface GatewayField {
  key: string;
  label: string;
  secret: boolean; // true → stored encrypted; false → stored in `config`
  placeholder?: string;
  help?: string;
  optional?: boolean;
}

export interface CheckoutContext {
  amount: number; // major units, e.g. 25.00
  currency: string; // ISO code, e.g. "USD", "INR"
  orderId: string; // our payments.id
  callbackUrl: string; // gateway → our webhook
  returnUrl: string; // customer comes back here after paying
  config: Record<string, string>; // public fields
  secrets: Record<string, string>; // decrypted secret fields
  customerEmail?: string | null;
}

export interface WebhookContext {
  raw: string; // exact raw request body (needed for signature checks)
  headers: Headers;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

export interface GatewayAdapter {
  id: string; // "cryptomus" | "razorpay" | "stripe" | …
  label: string;
  /** Short note shown in the catalog (e.g. "India · UPI, cards, netbanking"). */
  note: string;
  /** Credential fields the owner must enter to connect. */
  fields: GatewayField[];
  /** Create a hosted checkout; return the redirect URL + the gateway's own ref. */
  createCheckout(ctx: CheckoutContext): Promise<{ url: string; ref: string }>;
  /**
   * Extract which of OUR payment ids a webhook body refers to, BEFORE verifying
   * (so we can look up the panel's secrets). Return null to ignore.
   */
  extractOrderId(raw: string, headers: Headers): string | null;
  /** Authoritatively verify the webhook and report whether it's paid. */
  verifyWebhook(ctx: WebhookContext): Promise<{ paid: boolean }>;
}

/** How a gateway is grouped in the customer's Add-Funds chooser. */
export type PaymentCategory = "crypto" | "card" | "ewallet" | "bank";

/** Catalog entry — includes gateways not yet implemented (shown as "coming soon"). */
export interface CatalogEntry {
  id: string;
  label: string;
  note: string;
  category: PaymentCategory;
  available: boolean; // false → visible but not yet connectable
}
