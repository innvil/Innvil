import "server-only";
import crypto from "crypto";

/* =========================================================
   NOWPayments API (crypto payments) — server only.
   Auth: header { x-api-key: <API key> } on API calls.
   Webhooks (IPN): signed with HMAC-SHA512 over the JSON body with keys sorted
   alphabetically, using the IPN Secret key; signature arrives in header
   `x-nowpayments-sig`.
   Docs: https://documenter.getpostman.com/view/7907941/S1a32n38
   ========================================================= */

export interface NowPaymentsCreds {
  apiKey: string;
  ipnSecret: string;
}

const BASE = "https://api.nowpayments.io/v1";

async function call(
  apiKey: string,
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown> }
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method,
      headers: {
        "x-api-key": apiKey,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`Could not reach NOWPayments: ${e instanceof Error ? e.message : "network error"}`);
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) throw new Error(`NOWPayments returned a non-JSON response (HTTP ${res.status})`);
  if (!res.ok) {
    const msg = typeof json.message === "string" ? json.message : `NOWPayments HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/** Lightweight connectivity/credential check (also confirms the key is valid). */
export async function getStatus(apiKey: string): Promise<boolean> {
  try {
    const json = await call(apiKey, "/status", { method: "GET" });
    return json.message === "OK";
  } catch {
    return false;
  }
}

export interface CreateInvoiceParams {
  amount: string; // e.g. "10.00"
  currency: string; // fiat/price currency, e.g. "USD"
  orderId: string; // our payment id
  callbackUrl: string; // IPN
  returnUrl?: string; // success_url
  cancelUrl?: string;
}

/** Create a hosted-checkout invoice. Returns the pay URL + NOWPayments invoice id. */
export async function createInvoice(
  apiKey: string,
  p: CreateInvoiceParams
): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    price_amount: Number(p.amount),
    price_currency: p.currency.toLowerCase(),
    order_id: p.orderId,
    ipn_callback_url: p.callbackUrl,
  };
  if (p.returnUrl) body.success_url = p.returnUrl;
  if (p.cancelUrl) body.cancel_url = p.cancelUrl;
  const json = await call(apiKey, "/invoice", { method: "POST", body });
  const url = json.invoice_url;
  const id = json.id;
  if (typeof url !== "string" || !url) throw new Error("NOWPayments did not return a checkout URL");
  return { id: id != null ? String(id) : "", url };
}

/** Authoritative server-to-server payment status lookup. */
export async function getPaymentStatus(
  apiKey: string,
  paymentId: string
): Promise<{ status: string } | null> {
  const json = await call(apiKey, `/payment/${encodeURIComponent(paymentId)}`, { method: "GET" });
  const status = json.payment_status;
  if (typeof status !== "string") return null;
  return { status };
}

// `finished` = fully paid & settled. `confirmed`/`sending` are in-flight but paid
// on-chain; we credit only once fully finished to avoid crediting reversible states.
const SUCCESS_STATUSES = new Set(["finished"]);
export function isPaidStatus(status: string): boolean {
  return SUCCESS_STATUSES.has(status);
}

/**
 * Recreate NOWPayments' IPN signature: HMAC-SHA512 of the JSON body with keys
 * sorted alphabetically (recursively), keyed by the IPN Secret. Compared in
 * constant time against the `x-nowpayments-sig` header.
 */
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortedJson(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

export function verifyIpnSignature(rawBody: string, signature: string | null, ipnSecret: string): boolean {
  if (!signature || !ipnSecret) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const normalized = JSON.stringify(sortedJson(parsed));
  const expected = crypto.createHmac("sha512", ipnSecret).update(normalized).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
