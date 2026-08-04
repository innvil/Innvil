import "server-only";
import crypto from "node:crypto";

/* =========================================================
   Binance personal Pay-history client (server-only).
   Signed USER_DATA endpoint: GET /sapi/v1/pay/transactions (HMAC-SHA256).
   Used to reconcile incoming Binance Pay transfers into wallet credits. This is NOT
   the Binance merchant API — it only reads the connected account's own Pay history.
   ========================================================= */

const API_BASE_URL = "https://api.binance.com";

export interface BinanceSecrets {
  apiKey: string;
  apiSecret: string;
}

/** One raw Pay-history record (only the fields we use are typed). */
export interface BinancePayRecord {
  transactionId: string;
  orderType: string; // e.g. "C2C" | "PAY" | "MERCHANT_PAYMENT"
  transactionTime: number; // epoch ms
  amount: string; // positive = received, negative = sent
  currency: string;
  receiverInfo?: { binanceId?: string | number; type?: string } | null;
  payerInfo?: { name?: string | null } | null;
  [k: string]: unknown;
}

function signedQuery(secret: string, params: Record<string, string | number | undefined>): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

export interface PayTxParams {
  startTime?: number;
  endTime?: number;
  limit?: number; // max 100
}

/**
 * Fetch the connected account's Binance Pay history. Throws on rate-limit / auth /
 * malformed responses so callers can surface a clear error.
 */
export async function getPayTransactions(secrets: BinanceSecrets, opts: PayTxParams = {}): Promise<BinancePayRecord[]> {
  if (!secrets.apiKey || !secrets.apiSecret) throw new Error("Binance API key/secret not configured.");

  const query = signedQuery(secrets.apiSecret, {
    startTime: opts.startTime,
    endTime: opts.endTime,
    limit: Math.min(opts.limit ?? 100, 100),
    recvWindow: 5000,
    timestamp: Date.now(),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/sapi/v1/pay/transactions?${query}`, {
      method: "GET",
      headers: { "X-MBX-APIKEY": secrets.apiKey },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) throw new Error("Binance rate limit reached — try again shortly.");
  const text = await res.text();
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}: ${text.slice(0, 300)}`);

  let body: { success?: boolean; code?: string; data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Unexpected Binance response (not JSON).");
  }
  if (body.success !== true || body.code !== "000000" || !Array.isArray(body.data)) {
    throw new Error(`Unexpected Binance response: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.data as BinancePayRecord[];
}
