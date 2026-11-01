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
const DEFAULT_RECV_WINDOW = 5000;
const DEFAULT_LIMIT = 100;

export type BinanceErrorKind = "auth" | "api" | "network" | "parse" | "before_send";
export type BinanceFailureStage = "before_sending_request" | "during_network_tls_dns" | "binance_http_response" | "while_parsing_response";

export interface BinanceRequestDiagnostics {
  requestStartIso: string;
  requestStartMs: number;
  stage: BinanceFailureStage;
  status: number | null;
  contentType: string | null;
  binanceCode: string | null;
  binanceMessage: string | null;
  networkError: string | null;
  networkErrorCode: string | null;
  method: "GET";
  apiBaseUrl: string;
  endpointPath: string;
  finalUrlRedacted: string;
  unsignedQueryString: string;
  signedParamOrder: string[];
  signatureGeneration: "after_url_encoding";
  timestampMs: number;
  timestampIsMilliseconds: boolean;
  recvWindow: number;
  queryParamNames: string[];
  xMbxApiKeyHeaderPresent: boolean;
  maskedApiKey: string | null;
  apiKeyHasOuterQuotes: boolean;
  apiSecretHasOuterQuotes: boolean;
  apiKeyHasLeadingOrTrailingWhitespace: boolean;
  apiSecretHasLeadingOrTrailingWhitespace: boolean;
  apiKeyContainsNewline: boolean;
  apiSecretContainsNewline: boolean;
  productionEnvLoaded: Record<string, boolean>;
  binanceServerTimeMs: number | null;
  localServerTimeMs: number;
  localVsBinanceTimeDiffMs: number | null;
  pageLimit: number;
  expectedRecordCountCap: number;
}

export class BinanceApiError extends Error {
  kind: BinanceErrorKind;
  stage: BinanceFailureStage;
  httpStatus: number | null;
  binanceCode: string | null;
  binanceMessage: string | null;
  diagnostics: BinanceRequestDiagnostics | null;

  constructor(
    message: string,
    opts: {
      kind: BinanceErrorKind;
      stage: BinanceFailureStage;
      httpStatus?: number | null;
      binanceCode?: string | null;
      binanceMessage?: string | null;
      diagnostics?: BinanceRequestDiagnostics | null;
    }
  ) {
    super(message);
    this.name = "BinanceApiError";
    this.kind = opts.kind;
    this.stage = opts.stage;
    this.httpStatus = opts.httpStatus ?? null;
    this.binanceCode = opts.binanceCode ?? null;
    this.binanceMessage = opts.binanceMessage ?? null;
    this.diagnostics = opts.diagnostics ?? null;
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

function deriveInternalCode(httpStatus: number | null, binanceCode: string | null, msg: string | null, kind: BinanceErrorKind): string {
  const text = String(msg ?? "").toLowerCase();
  if (httpStatus === 451) return "BINANCE_REGION_RESTRICTED";
  if (kind === "network") return "BINANCE_NETWORK_ERROR";
  if (kind === "parse") return "BINANCE_NON_JSON_RESPONSE";
  if (binanceCode === "-1022" || /signature/.test(text)) return "BINANCE_INVALID_SIGNATURE";
  if (binanceCode === "-1021" || /timestamp|recvwindow/.test(text)) return "BINANCE_TIMESTAMP_OUTSIDE_WINDOW";
  if (binanceCode === "-2008" || binanceCode === "-2014" || binanceCode === "-2015" || /invalid api[- ]?key|api key/.test(text)) {
    if (/ip/.test(text)) return "BINANCE_IP_RESTRICTED";
    return "BINANCE_INVALID_API_KEY";
  }
  if (httpStatus === 403 || /permission|not authorized|forbidden/.test(text)) return "BINANCE_PERMISSION_DENIED";
  if (httpStatus === 429 || binanceCode === "-1003" || /too many requests|rate limit/.test(text)) return "BINANCE_RATE_LIMITED";
  return "BINANCE_UNKNOWN_ERROR";
}

function shortTextPreview(value: string, max = 300): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
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

function hasOuterQuotes(value: string): boolean {
  const t = value.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
}

function extractNetworkErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const c1 = typeof e.code === "string" ? e.code : null;
  const c2 = typeof e.cause?.code === "string" ? e.cause.code : null;
  return c1 ?? c2;
}

function redactSignedUrl(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    if (u.searchParams.has("signature")) u.searchParams.set("signature", "REDACTED");
    return u.toString();
  } catch {
    return fullUrl.replace(/signature=[^&]+/g, "signature=REDACTED");
  }
}

async function fetchBinanceServerTime(): Promise<{ serverTimeMs: number | null; localMs: number; diffMs: number | null }> {
  const localMs = Date.now();
  try {
    const res = await fetch(`${API_BASE_URL}/api/v3/time`, { method: "GET", cache: "no-store" });
    if (!res.ok) return { serverTimeMs: null, localMs, diffMs: null };
    const body = (await res.json()) as { serverTime?: unknown };
    const serverTimeMs = toNumber(body.serverTime);
    return {
      serverTimeMs,
      localMs,
      diffMs: serverTimeMs == null ? null : localMs - serverTimeMs,
    };
  } catch {
    return { serverTimeMs: null, localMs, diffMs: null };
  }
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

interface SignedQueryMeta {
  unsignedQuery: string;
  paramOrder: string[];
  signature: string;
  signedQuery: string;
  timestampMs: number;
  recvWindow: number;
}

function signedQueryMeta(secret: string, params: Record<string, string | number | undefined>): SignedQueryMeta {
  const filtered = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  const paramOrder = filtered.map(([k]) => k);
  const unsignedQuery = filtered
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const signature = crypto.createHmac("sha256", secret).update(unsignedQuery).digest("hex");
  const signedQuery = `${unsignedQuery}&signature=${signature}`;
  return {
    unsignedQuery,
    paramOrder,
    signature,
    signedQuery,
    timestampMs: Number(params.timestamp),
    recvWindow: Number(params.recvWindow),
  };
}

export interface PayTxParams {
  startTime?: number;
  endTime?: number;
  limit?: number; // max 100
}

function parseTransactionsResponse(text: string, diagnostics: BinanceRequestDiagnostics): { code: string | null; message: string | null; data: unknown[] } {
  let body: BinanceTransactionsResponse;
  try {
    body = JSON.parse(text) as BinanceTransactionsResponse;
  } catch {
    throw new BinanceApiError("Unexpected Binance response (not JSON).", {
      kind: "parse",
      stage: "while_parsing_response",
      diagnostics,
    });
  }

  const code = toText(body.code);
  const message = toText(body.message) ?? toText(body.msg);
  diagnostics.binanceCode = code;
  diagnostics.binanceMessage = message;

  if (code !== BINANCE_SUCCESS_CODE) {
    throw new BinanceApiError(
      `Binance API rejected the request (${code ?? "no-code"}${message ? `: ${message}` : ""}).`,
      {
        kind: "api",
        stage: "binance_http_response",
        binanceCode: code,
        binanceMessage: message,
        diagnostics,
      }
    );
  }

  if (!Array.isArray(body.data)) {
    throw new BinanceApiError("Binance response is malformed (data is not an array).", {
      kind: "parse",
      stage: "while_parsing_response",
      binanceCode: code,
      binanceMessage: message,
      diagnostics,
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
async function executePayTransactions(secrets: BinanceSecrets, opts: PayTxParams = {}): Promise<{ records: BinancePayRecord[]; diagnostics: BinanceRequestDiagnostics }> {
  const requestStartMs = Date.now();
  const requestStartIso = new Date(requestStartMs).toISOString();
  if (!secrets.apiKey || !secrets.apiSecret) {
    throw new BinanceApiError("Binance API key/secret not configured.", {
      kind: "before_send",
      stage: "before_sending_request",
      diagnostics: null,
    });
  }

  const recvWindow = DEFAULT_RECV_WINDOW;
  const timestampMs = Date.now();
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
  const signatureMeta = signedQueryMeta(secrets.apiSecret, {
    startTime: opts.startTime,
    endTime: opts.endTime,
    limit,
    recvWindow,
    timestamp: timestampMs,
  });

  const requestUrl = `${API_BASE_URL}/sapi/v1/pay/transactions?${signatureMeta.signedQuery}`;
  const targetHost = new URL(API_BASE_URL).hostname;
  const vercelEnvironment = process.env.VERCEL_ENV === "production" ? "Production" : process.env.VERCEL_ENV === "preview" ? "Preview" : "Development";
  const vercelRegion = process.env.VERCEL_REGION ?? null;
  const timeSync = await fetchBinanceServerTime();

  const diagnostics: BinanceRequestDiagnostics = {
    requestStartIso,
    requestStartMs,
    stage: "before_sending_request",
    status: null,
    contentType: null,
    binanceCode: null,
    binanceMessage: null,
    networkError: null,
    networkErrorCode: null,
    method: "GET",
    apiBaseUrl: API_BASE_URL,
    endpointPath: "/sapi/v1/pay/transactions",
    finalUrlRedacted: redactSignedUrl(requestUrl),
    unsignedQueryString: signatureMeta.unsignedQuery,
    signedParamOrder: signatureMeta.paramOrder,
    signatureGeneration: "after_url_encoding",
    timestampMs: signatureMeta.timestampMs,
    timestampIsMilliseconds: signatureMeta.timestampMs > 1_000_000_000_000,
    recvWindow: signatureMeta.recvWindow,
    queryParamNames: [...signatureMeta.paramOrder, "signature"],
    xMbxApiKeyHeaderPresent: true,
    maskedApiKey: maskValue(secrets.apiKey),
    apiKeyHasOuterQuotes: hasOuterQuotes(secrets.apiKey),
    apiSecretHasOuterQuotes: hasOuterQuotes(secrets.apiSecret),
    apiKeyHasLeadingOrTrailingWhitespace: secrets.apiKey !== secrets.apiKey.trim(),
    apiSecretHasLeadingOrTrailingWhitespace: secrets.apiSecret !== secrets.apiSecret.trim(),
    apiKeyContainsNewline: /[\r\n]/.test(secrets.apiKey),
    apiSecretContainsNewline: /[\r\n]/.test(secrets.apiSecret),
    productionEnvLoaded: {
      NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      PROVIDER_KEY_SECRET: Boolean(process.env.PROVIDER_KEY_SECRET),
      VERCEL: Boolean(process.env.VERCEL),
      VERCEL_ENV: Boolean(process.env.VERCEL_ENV),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
    },
    binanceServerTimeMs: timeSync.serverTimeMs,
    localServerTimeMs: timeSync.localMs,
    localVsBinanceTimeDiffMs: timeSync.diffMs,
    pageLimit: limit,
    expectedRecordCountCap: DEFAULT_LIMIT,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    diagnostics.stage = "during_network_tls_dns";
    console.info("[binance-pay] runtime-region", {
      vercelRegion: process.env.VERCEL_REGION ?? "unknown",
      vercelEnv: process.env.VERCEL_ENV ?? "unknown",
      nodeEnv: process.env.NODE_ENV ?? "unknown",
      hostname: "api.binance.com",
    });
    res = await fetch(requestUrl, {
      method: "GET",
      headers: { "X-MBX-APIKEY": secrets.apiKey },
      signal: controller.signal,
    });
  } catch (error) {
    const networkErrorName = error instanceof Error ? error.name : "UnknownError";
    const networkErrorCode = extractNetworkErrorCode(error);
    const internalCode = deriveInternalCode(null, null, null, "network");
    console.error("[binance-pay] network-failed", {
      internalCode,
      networkErrorName,
      networkErrorCode,
      vercelRegion,
      vercelEnvironment,
      targetHost,
      timestampOffsetMs: diagnostics.localVsBinanceTimeDiffMs,
      recvWindow: diagnostics.recvWindow,
      apiKeyPresent: Boolean(secrets.apiKey),
      apiSecretPresent: Boolean(secrets.apiSecret),
    });
    diagnostics.stage = "during_network_tls_dns";
    diagnostics.networkError = error instanceof Error ? error.message : String(error);
    diagnostics.networkErrorCode = networkErrorCode;
    throw new BinanceApiError("Binance network request failed.", {
      kind: "network",
      stage: "during_network_tls_dns",
      diagnostics,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  diagnostics.stage = "binance_http_response";
  diagnostics.status = res.status;
  diagnostics.contentType = res.headers.get("content-type");

  console.info("[binance-pay] fetch", {
    requestStartIso: diagnostics.requestStartIso,
    stage: diagnostics.stage,
    status: diagnostics.status,
    contentType: diagnostics.contentType,
    apiKey: diagnostics.maskedApiKey,
    timestamp: diagnostics.timestampMs,
    recvWindow: diagnostics.recvWindow,
    queryParamNames: diagnostics.queryParamNames,
    unsignedQuery: diagnostics.unsignedQueryString,
    signedParamOrder: diagnostics.signedParamOrder,
    xMbxApiKeyHeaderPresent: diagnostics.xMbxApiKeyHeaderPresent,
    localVsBinanceTimeDiffMs: diagnostics.localVsBinanceTimeDiffMs,
  });

  if (!res.ok) {
    let code: string | null = null;
    let message: string | null = null;
    let nonJsonPreview: string | null = null;
    const responsePreview = shortTextPreview(text, 300) || null;
    try {
      const parsed = JSON.parse(text) as BinanceTransactionsResponse;
      code = toText(parsed.code);
      message = toText(parsed.message) ?? toText(parsed.msg);
    } catch {
      nonJsonPreview = shortTextPreview(text, 300);
      message = "non-json-error-response";
    }
    diagnostics.binanceCode = code;
    diagnostics.binanceMessage = message;
    const auth = isAuthFailure(res.status, code, message);
    const internalCode = deriveInternalCode(res.status, code, message, auth ? "auth" : "api");
    if (res.status === 451) {
      console.error("[binance-pay] region-restricted", {
        httpStatus: 451,
        internalCode: "BINANCE_REGION_RESTRICTED",
        vercelRegion: process.env.VERCEL_REGION ?? "unknown",
        responseContentType: diagnostics.contentType,
        responsePreview,
      });
    }
    console.error("[binance-pay] request-failed", {
      httpStatus: res.status,
      binanceCode: code,
      binanceMessage: message,
      internalCode,
      responseContentType: diagnostics.contentType,
      responsePreview: nonJsonPreview,
      vercelRegion,
      vercelEnvironment,
      targetHost,
      networkErrorName: null,
      networkErrorCode: null,
      timestampOffsetMs: diagnostics.localVsBinanceTimeDiffMs,
      recvWindow: diagnostics.recvWindow,
      apiKeyPresent: Boolean(secrets.apiKey),
      apiSecretPresent: Boolean(secrets.apiSecret),
    });
    throw new BinanceApiError(
      auth ? "Binance authentication failed." : `Binance API request failed (HTTP ${res.status}).`,
      {
        kind: auth ? "auth" : "api",
        stage: "binance_http_response",
        httpStatus: res.status,
        binanceCode: code,
        binanceMessage: message,
        diagnostics,
      }
    );
  }

  const parsed = parseTransactionsResponse(text, diagnostics);
  const records = parsed.data
    .map((x) => mapRecord(x))
    .filter((x): x is BinancePayRecord => x !== null);

  console.info("[binance-pay] response", {
    code: parsed.code,
    message: parsed.message,
    count: records.length,
  });
  logTxSummary(records);
  return { records, diagnostics };
}

export async function getPayTransactions(secrets: BinanceSecrets, opts: PayTxParams = {}): Promise<BinancePayRecord[]> {
  const out = await executePayTransactions(secrets, opts);
  return out.records;
}

export async function diagnosePayTransactions(
  secrets: BinanceSecrets,
  opts: PayTxParams = {}
): Promise<{ ok: true; diagnostics: BinanceRequestDiagnostics; count: number } | { ok: false; diagnostics: BinanceRequestDiagnostics | null; error: { kind: BinanceErrorKind; code: string; message: string; stage: BinanceFailureStage; httpStatus: number | null; binanceCode: string | null; binanceMessage: string | null; networkErrorCode: string | null } }> {
  try {
    const out = await executePayTransactions(secrets, opts);
    return {
      ok: true,
      diagnostics: out.diagnostics,
      count: out.records.length,
    };
  } catch (error) {
    if (error instanceof BinanceApiError) {
      return {
        ok: false,
        diagnostics: error.diagnostics,
        error: {
          kind: error.kind,
          code: error.binanceCode ?? "BINANCE_UNKNOWN_ERROR",
          message: error.message,
          stage: error.stage,
          httpStatus: error.httpStatus,
          binanceCode: error.binanceCode,
          binanceMessage: error.binanceMessage,
          networkErrorCode: error.diagnostics?.networkErrorCode ?? null,
        },
      };
    }
    return {
      ok: false,
      diagnostics: null,
      error: {
        kind: "api",
        code: "BINANCE_UNKNOWN_ERROR",
        message: error instanceof Error ? error.message : String(error),
        stage: "before_sending_request",
        httpStatus: null,
        binanceCode: null,
        binanceMessage: null,
        networkErrorCode: null,
      },
    };
  }
}
