"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { syncPanelBinanceHistory } from "@/src/lib/payments/binance-sync";
import { BinanceApiError } from "@/src/lib/payments/binance";
import { loadActiveBinanceCredentials } from "@/src/lib/payments/binance-credentials";
import { paymentBelongsToRequestScope } from "@/src/lib/payments/binance-scope";
import { round4 } from "@/src/lib/money";
import {
  ACCEPTED_ASSET, EXPIRY_MINUTES, TX_COLS,
  pickPayable, validateTx, findMatchingTx, creditMatch,
  normalizeEnteredTransactionId, isValidTransactionIdFormat,
  type PendingIntent, type BinanceTx, type BinanceClaimResult,
} from "@/src/lib/payments/binance-match";

/* =========================================================
   Binance Pay — customer deposit actions (create + confirm).
   The customer pays a UNIQUE amount to the owner's Pay ID; we match it to exactly one
   pending deposit and credit the wallet (+ tiered bonus). Two confirm paths share the
   credit core in binance-match.ts: auto-detect (no TXID) and an explicit TXID submit
   (fallback). Personal-account reconciliation — NOT a merchant checkout.
   ========================================================= */

function readPanelCurrency(settings: unknown): string {
  if (settings && typeof settings === "object") {
    const c = (settings as Record<string, unknown>).currency;
    if (typeof c === "string" && c) return c.toUpperCase();
  }
  return "USD";
}

function minTopup(config: Record<string, string> | undefined): number {
  const n = Number(config?.minTopup);
  return Number.isFinite(n) && n > 0 ? round4(n) : 1;
}

export interface BinanceDepositInfo {
  paymentId: string;
  payId: string;
  qrImage: string | null;
  /** The requested top-up (what gets credited, before bonus). */
  amount: number;
  /** The EXACT amount the customer must send (base + unique tail). */
  payable: number;
  asset: string; // "USDT"
  /** ISO time the deposit request expires (pay + verify within this window). */
  expiresAt: string;
  instructions: string[];
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SYNC_PAGES = 8;

function paymentWindowMs(intent: PendingIntent): { startTime: number; endTime: number } {
  const created = new Date(intent.created_at).getTime();
  const startTime = Math.max(0, created - CLOCK_SKEW_MS);
  const endTime = Math.max(startTime, created + EXPIRY_MINUTES * 60_000 + CLOCK_SKEW_MS);
  return { startTime, endTime };
}

function maskValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function mapSyncError(error: unknown): BinanceClaimResult {
  if (error instanceof BinanceApiError) {
    const code = error.binanceCode ?? "";
    const msg = String(error.binanceMessage ?? error.message ?? "").toLowerCase();
    if (code === "BINANCE_NOT_CONFIGURED") {
      return { ok: false, code: "BINANCE_NOT_CONFIGURED", message: "Binance Pay is not configured for this panel." };
    }
    if (error.kind === "network") {
      return { ok: false, code: "BINANCE_NETWORK_ERROR", message: "Could not reach Binance (network/DNS/TLS). Please try again shortly." };
    }
    if (error.kind === "parse") {
      return { ok: false, code: "BINANCE_NON_JSON_RESPONSE", message: "Binance returned an unexpected non-JSON response." };
    }
    if (code === "-1022" || /signature/.test(msg)) {
      return { ok: false, code: "BINANCE_INVALID_SIGNATURE", message: "Binance rejected the request signature." };
    }
    if (code === "-1021" || /timestamp|recvwindow/.test(msg)) {
      return { ok: false, code: "BINANCE_TIMESTAMP_OUTSIDE_WINDOW", message: "Binance rejected the request time window." };
    }
    if (code === "-2008" || code === "-2014" || code === "-2015" || /invalid api[- ]?key|api key/.test(msg)) {
      if (/ip/.test(msg)) {
        return { ok: false, code: "BINANCE_IP_RESTRICTED", message: "Binance API key IP restriction rejected this request." };
      }
      return { ok: false, code: "BINANCE_INVALID_API_KEY", message: "Binance API key or secret is invalid for this request." };
    }
    if (error.httpStatus === 403 || /permission|not authorized|forbidden/.test(msg)) {
      return { ok: false, code: "BINANCE_PERMISSION_DENIED", message: "Binance denied permission for this API key." };
    }
    if (error.httpStatus === 429 || code === "-1003" || /too many requests|rate limit/.test(msg)) {
      return { ok: false, code: "BINANCE_RATE_LIMITED", message: "Binance rate limit reached. Please try again shortly." };
    }
    return { ok: false, code: "BINANCE_UNKNOWN_ERROR", message: "Binance request failed. Please try again shortly." };
  }
  return { ok: false, code: "BINANCE_UNKNOWN_ERROR", message: "Could not query Binance right now. Please try again shortly." };
}

function notConfigured(): BinanceClaimResult {
  return { ok: false, code: "BINANCE_NOT_CONFIGURED", message: "Binance Pay is not configured for this panel." };
}

/** Create a pending Binance Pay deposit and return the pay-to details. */
export async function createBinanceDeposit(panelId: string, amount: number): Promise<Result<BinanceDepositInfo>> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to add funds." };

  const admin = createAdminClient();
  const { data: panel } = await admin.from("panels").select("id, status, settings").eq("id", panelId).maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found." };
  if (panel.status !== "live" && panel.status !== "inactive") return { ok: false, error: "Deposits are unavailable on this panel right now." };

  const { data: acct } = await admin
    .from("customer_accounts").select("id, status").eq("panel_id", panelId).eq("user_id", user.id).maybeSingle();
  if (!acct) return { ok: false, error: "No account found on this panel." };
  if (acct.status === "banned") return { ok: false, error: "Your account can't add funds right now." };

  const amt = round4(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "Enter a valid amount." };

  const creds = await loadActiveBinanceCredentials(panelId);
  if (!creds.ok) return { ok: false, error: "Binance Pay isn't fully configured yet." };
  const payId = (creds.config.payId ?? "").trim();
  if (!payId) {
    return { ok: false, error: "Binance Pay isn't fully configured yet." };
  }
  const min = minTopup(creds.config);
  if (amt < min) return { ok: false, error: `Minimum Binance Pay deposit is ${min.toFixed(2)} ${ACCEPTED_ASSET}.` };

  const payable = await pickPayable(admin, panelId, amt);
  const currency = readPanelCurrency(panel.settings);
  const { data: pay, error } = await admin
    .from("payments")
    .insert({ panel_id: panelId, customer_id: acct.id, method: "Binance Pay", amount: amt, binance_payable: payable, currency, status: "pending", gateway: "binance_pay" })
    .select("id, created_at")
    .single();
  if (error || !pay) return { ok: false, error: error?.message ?? "Could not start the deposit." };

  const expiresAt = new Date(new Date(pay.created_at as string).getTime() + EXPIRY_MINUTES * 60_000).toISOString();
  return {
    ok: true,
    data: {
      paymentId: pay.id as string,
      payId,
      qrImage: (creds.config.qrImage ?? "").trim() || null,
      amount: amt,
      payable,
      asset: ACCEPTED_ASSET,
      expiresAt,
      instructions: [
        `Open Binance → Pay and send EXACTLY ${payable} ${ACCEPTED_ASSET} to Pay ID ${payId}.`,
        "The exact amount is how we match your payment — send it precisely.",
        "Use Binance Pay — NOT an on-chain/blockchain withdrawal.",
        `Pay within ${EXPIRY_MINUTES} minutes; we detect it automatically (or paste your transaction ID).`,
      ],
    },
  };
}

async function loadOpenIntent(
  admin: SupabaseClient, panelId: string, paymentId: string, customerId: string
): Promise<PendingIntent | { error: BinanceClaimResult }> {
  const { data: payment } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, amount, binance_payable, status, gateway, created_at")
    .eq("id", paymentId)
    .maybeSingle();
  if (!paymentBelongsToRequestScope(payment, panelId, customerId)) {
    return { error: { ok: false, code: "DEPOSIT_NOT_FOUND", message: "Deposit request not found." } };
  }
  if (payment.status === "completed") return { error: { ok: false, code: "ALREADY_PAID", message: "This deposit has already been credited." } };
  if (payment.status !== "pending") return { error: { ok: false, code: "DEPOSIT_NOT_OPEN", message: `This deposit can't be processed (status: ${payment.status}).` } };
  if (Date.now() > new Date(payment.created_at as string).getTime() + EXPIRY_MINUTES * 60_000) {
    return { error: { ok: false, code: "EXPIRED", message: `This deposit expired (${EXPIRY_MINUTES}-minute window). Start a new deposit and pay again.` } };
  }
  return {
    id: payment.id as string,
    customer_id: payment.customer_id as string,
    amount: String(payment.amount),
    binance_payable: payment.binance_payable != null ? String(payment.binance_payable) : null,
    created_at: payment.created_at as string,
  };
}

/** Auto-detect: sync history and match a transaction to this deposit by its unique
 *  payable amount (no transaction id needed). */
export async function checkBinanceDeposit(panelId: string, paymentId: string): Promise<BinanceClaimResult> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, code: "AUTH", message: "Please log in." };

  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("customer_accounts").select("id").eq("panel_id", panelId).eq("user_id", user.id).maybeSingle();
  if (!acct) return { ok: false, code: "NO_ACCOUNT", message: "No account found on this panel." };

  const loaded = await loadOpenIntent(admin, panelId, paymentId, acct.id as string);
  if ("error" in loaded) return loaded.error;
  const intent = loaded;
  if (intent.binance_payable == null) {
    return { ok: false, code: "TRANSACTION_NOT_FOUND", pending: true, message: "Auto-detect isn't available for this deposit — paste your transaction ID instead." };
  }

  const creds = await loadActiveBinanceCredentials(panelId);
  if (!creds.ok) return notConfigured();
  const expectedUid = (creds.config.binanceUid ?? "").trim();
  const { startTime, endTime } = paymentWindowMs(intent);

  let tx = await findMatchingTx(admin, panelId, intent, expectedUid, startTime, endTime);
  if (!tx) {
    try {
      await syncPanelBinanceHistory(panelId, { startTime, endTime, maxPages: MAX_SYNC_PAGES });
    } catch (error) {
      return mapSyncError(error);
    }
    tx = await findMatchingTx(admin, panelId, intent, expectedUid, startTime, endTime);
  }
  if (!tx) {
    return { ok: false, code: "TRANSACTION_NOT_FOUND", pending: true, message: `We haven't detected your C2C Binance Pay transfer yet. If you just paid, give it a few seconds.` };
  }
  return creditMatch(admin, intent, tx, creds.config ?? null);
}

/** Fallback: verify a specific transaction id the customer pasted. */
export async function claimBinancePayment(
  panelId: string,
  paymentId: string,
  transactionId: string
): Promise<BinanceClaimResult> {
  const txId = normalizeEnteredTransactionId(transactionId);
  if (!isValidTransactionIdFormat(txId)) {
    return { ok: false, code: "INVALID_TRANSACTION_ID", message: "That doesn't look like a Binance Pay transaction ID." };
  }

  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, code: "AUTH", message: "Please log in." };

  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("customer_accounts").select("id").eq("panel_id", panelId).eq("user_id", user.id).maybeSingle();
  if (!acct) return { ok: false, code: "NO_ACCOUNT", message: "No account found on this panel." };

  const loaded = await loadOpenIntent(admin, panelId, paymentId, acct.id as string);
  if ("error" in loaded) return loaded.error;
  const intent = loaded;
  const creds = await loadActiveBinanceCredentials(panelId);
  if (!creds.ok) return notConfigured();
  const { startTime, endTime } = paymentWindowMs(intent);

  const { data: usedElsewhere } = await admin.from("payments").select("id").eq("binance_tx_id", txId).maybeSingle();
  if (usedElsewhere) return { ok: false, code: "TRANSACTION_ALREADY_USED", message: "This Binance transaction has already been used." };

  console.info("[binance-claim] verifying", {
    panelId,
    paymentId,
    txId: maskValue(txId),
    windowStart: new Date(startTime).toISOString(),
    windowEnd: new Date(endTime).toISOString(),
  });

  const loadTx = async (): Promise<BinanceTx | null> =>
    (await admin.from("binance_pay_transactions").select(TX_COLS).eq("panel_id", panelId).eq("transaction_id", txId).maybeSingle()).data as BinanceTx | null;
  let tx = await loadTx();
  if (!tx) {
    try {
      await syncPanelBinanceHistory(panelId, {
        startTime,
        endTime,
        maxPages: MAX_SYNC_PAGES,
        stopWhenTransactionId: txId,
      });
    } catch (error) {
      return mapSyncError(error);
    }
    tx = await loadTx();
  }
  if (!tx) {
    return { ok: false, code: "TRANSACTION_NOT_FOUND", pending: true, message: "That transaction ID was not found in Binance Pay history for this deposit window." };
  }

  if (normalizeEnteredTransactionId(tx.transaction_id) !== txId) {
    return { ok: false, code: "TRANSACTION_ID_MISMATCH", message: "The entered transaction ID does not match Binance's transactionId for this payment." };
  }

  const expectedUid = (creds.config.binanceUid ?? "").trim();
  const fail = validateTx(tx, intent, {
    expectedUid,
    requirePayableMatch: true,
    windowStartMs: startTime,
    windowEndMs: endTime,
  });
  if (fail) return { ok: false, ...fail };

  return creditMatch(admin, intent, tx, creds.config ?? null);
}
