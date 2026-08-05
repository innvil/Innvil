import "server-only";
import crypto from "node:crypto";

/* =========================================================
   Binance personal Pay-history client (server-only).
   Signed USER_DATA endpoint: GET /sapi/v1/pay/transactions (HMAC-SHA256).
   Used to reconcile incoming Binance Pay transfers into wallet credits. This is NOT
   the Binance merchant API — it only reads the connected account's own Pay history.
   ========================================================= */

const API_BASE_URL = "https://api.binance.com";
const BINANCE_SUCCESS_CODE = "000000";

export type BinanceErrorKind = "auth" | "api";

export class BinanceApiError extends Error {
  kind: BinanceErrorKind;
  httpStatus: number | null;
  binanceCode: string | null;
  binanceMessage: string | null;

  constructor(
    message: string,
    opts: { kind: BinanceErrorKind; httpStatus?: number | null; binanceCode?: string | null; binanceMessage?: string | null }
  ) {
    super(message);
    this.name = "BinanceApiError";
    this.kind = opts.kind;
    this.httpStatus = opts.httpStatus ?? null;
    this.binanceCode = opts.binanceCode ?? null;
    this.binanceMessage = opts.binanceMessage ?? null;
  }
}

function maskValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function isAuthFailure(httpStatus: number, binanceCode: string | null, msg: string | null): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  if (binanceCode && ["-2014", "-2015", "-1022"].includes(binanceCode)) return true;
  const text = String(msg ?? "").toLowerCase();
  return /api-key|api key|signature|invalid key|permission|unauthorized/.test(text);
}

function toText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function logTxSummary(records: BinancePayRecord[]) {
  const devFullIds = process.env.NODE_ENV !== "production" && process.env.BINANCE_DEBUG_FULL_IDS === "1";
  for (const tx of records.slice(0, 5)) {
    const payerId = toText(tx.payerInfo?.binanceId);
    const receiverId = toText(tx.receiverInfo?.binanceId);
    console.info("[binance-pay] tx", {
      transactionId: devFullIds ? tx.transactionId : maskValue(toText(tx.transactionId)),
      orderType: tx.orderType,
      amount: tx.amount,
      currency: tx.currency,
      transactionTime: tx.transactionTime,
      payerBinanceId: devFullIds ? payerId : maskValue(payerId),
      receiverBinanceId: devFullIds ? receiverId : maskValue(receiverId),
    });
  }
}

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
  payerInfo?: { name?: string | null; binanceId?: string | number } | null;
  [k: string]: unknown;
}

interface BinanceTransactionsResponse {
  code?: string | number;
  message?: string;
  msg?: string;
  data?: unknown;
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

function parseTransactionsResponse(text: string): { code: string | null; message: string | null; data: unknown[] } {
  let body: BinanceTransactionsResponse;
  try {
    body = JSON.parse(text) as BinanceTransactionsResponse;
  } catch {
    throw new BinanceApiError("Unexpected Binance response (not JSON).", { kind: "api" });
  }

  const code = toText(body.code);
  const message = toText(body.message) ?? toText(body.msg);

  if (code !== BINANCE_SUCCESS_CODE) {
    throw new BinanceApiError(
      `Binance API rejected the request (${code ?? "no-code"}${message ? `: ${message}` : ""}).`,
      { kind: "api", binanceCode: code, binanceMessage: message }
    );
  }

  if (!Array.isArray(body.data)) {
    throw new BinanceApiError("Binance response is malformed (data is not an array).", {
      kind: "api",
      binanceCode: code,
      binanceMessage: message,
    });
  }

  return { code, message, data: body.data };
}

function mapRecord(raw: unknown): BinancePayRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const transactionId = toText(r.transactionId);
  if (!transactionId) return null;
  return {
    ...r,
    transactionId,
    orderType: toText(r.orderType) ?? "",
    transactionTime: toNumber(r.transactionTime) ?? 0,
    amount: toText(r.amount) ?? "",
    currency: (toText(r.currency) ?? "").toUpperCase(),
    receiverInfo: r.receiverInfo && typeof r.receiverInfo === "object" ? (r.receiverInfo as { binanceId?: string | number; type?: string }) : null,
    payerInfo: r.payerInfo && typeof r.payerInfo === "object" ? (r.payerInfo as { name?: string | null; binanceId?: string | number }) : null,
  };
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
  const maskedKey = maskValue(secrets.apiKey);
  try {
    res = await fetch(`${API_BASE_URL}/sapi/v1/pay/transactions?${query}`, {
      method: "GET",
      headers: { "X-MBX-APIKEY": secrets.apiKey },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  console.info("[binance-pay] fetch", {
    status: res.status,
    apiKey: maskedKey,
    startTime: opts.startTime ?? null,
    endTime: opts.endTime ?? null,
    limit: Math.min(opts.limit ?? 100, 100),
  });

  if (!res.ok) {
    let code: string | null = null;
    let message: string | null = null;
    try {
      const parsed = JSON.parse(text) as BinanceTransactionsResponse;
      code = toText(parsed.code);
      message = toText(parsed.message) ?? toText(parsed.msg);
    } catch {
      message = text.slice(0, 300);
    }
    const auth = isAuthFailure(res.status, code, message);
    throw new BinanceApiError(
      auth ? "Binance authentication failed." : `Binance API request failed (HTTP ${res.status}).`,
      { kind: auth ? "auth" : "api", httpStatus: res.status, binanceCode: code, binanceMessage: message }
    );
  }

  const parsed = parseTransactionsResponse(text);
  const records = parsed.data
    .map((x) => mapRecord(x))
    .filter((x): x is BinancePayRecord => x !== null);

  console.info("[binance-pay] response", {
    code: parsed.code,
    message: parsed.message,
    count: records.length,
  });
  logTxSummary(records);
  return records;
}
