import "server-only";
import crypto from "crypto";

/* =========================================================
   Cryptomus merchant API (crypto payments) — server only.
   Auth: headers { merchant, sign } where
     sign = md5( base64(json_body) + api_key )
   Docs: https://doc.cryptomus.com/business
   ========================================================= */

export interface CryptomusCreds {
  merchantId: string;
  apiKey: string;
}

const BASE = "https://api.cryptomus.com/v1";

/** PHP json_encode-compatible: escape forward slashes so signs match Cryptomus. */
function phpJson(obj: unknown): string {
  return JSON.stringify(obj).replace(/\//g, "\\/");
}

function makeSign(jsonStr: string, apiKey: string): string {
  const b64 = Buffer.from(jsonStr, "utf8").toString("base64");
  return crypto.createHash("md5").update(b64 + apiKey).digest("hex");
}

async function call(
  creds: CryptomusCreds,
  path: string,
  body: Record<string, unknown>
): Promise<{ state?: number; result?: Record<string, unknown>; message?: string }> {
  const jsonStr = phpJson(body);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        merchant: creds.merchantId,
        sign: makeSign(jsonStr, creds.apiKey),
      },
      body: jsonStr,
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`Could not reach Cryptomus: ${e instanceof Error ? e.message : "network error"}`);
  }
  const json = (await res.json().catch(() => null)) as
    | { state?: number; result?: Record<string, unknown>; message?: string }
    | null;
  if (!json) throw new Error(`Cryptomus returned a non-JSON response (HTTP ${res.status})`);
  if (!res.ok && !json.result) throw new Error(json.message || `Cryptomus HTTP ${res.status}`);
  return json;
}

export interface CreateInvoiceParams {
  amount: string; // e.g. "10.00"
  currency: string; // e.g. "USD"
  orderId: string; // our payment id
  callbackUrl: string;
  returnUrl?: string;
  successUrl?: string;
}

/** Create a hosted-checkout invoice. Returns the pay URL + Cryptomus uuid. */
export async function createInvoice(
  creds: CryptomusCreds,
  p: CreateInvoiceParams
): Promise<{ uuid: string; url: string }> {
  const body: Record<string, unknown> = {
    amount: p.amount,
    currency: p.currency,
    order_id: p.orderId,
    url_callback: p.callbackUrl,
  };
  if (p.returnUrl) body.url_return = p.returnUrl;
  if (p.successUrl) body.url_success = p.successUrl;
  const json = await call(creds, "/payment", body);
  const r = json.result;
  if (!r?.url || !r?.uuid) throw new Error(json.message || "Cryptomus did not return a checkout URL");
  return { uuid: String(r.uuid), url: String(r.url) };
}

/** Authoritative server-to-server status check for one of our orders. */
export async function getPaymentInfo(
  creds: CryptomusCreds,
  orderId: string
): Promise<{ status: string; amount: string } | null> {
  const json = await call(creds, "/payment/info", { order_id: orderId });
  const r = json.result;
  if (!r) return null;
  return { status: String(r.status ?? ""), amount: String(r.amount ?? "") };
}

const SUCCESS_STATUSES = new Set(["paid", "paid_over"]);
export function isPaidStatus(status: string): boolean {
  return SUCCESS_STATUSES.has(status);
}

/**
 * Verify a webhook payload's `sign`. Best-effort (JSON re-encoding can differ from
 * the sender's) — the webhook handler ALSO confirms status server-to-server via
 * getPaymentInfo, which is authoritative, so a failing sign is not fatal on its own.
 */
export function verifyWebhookSign(payload: Record<string, unknown>, apiKey: string): boolean {
  const received = payload.sign;
  if (typeof received !== "string" || !received) return false;
  const rest: Record<string, unknown> = { ...payload };
  delete rest.sign;
  const expected = makeSign(phpJson(rest), apiKey);
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
