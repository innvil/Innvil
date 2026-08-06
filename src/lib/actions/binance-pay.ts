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
  pickPayable, validateTx, creditMatch,
  type PendingIntent, type BinanceTx, type BinanceClaimResult,
} from "@/src/lib/payments/binance-match";

/* =========================================================
   Binance Pay — customer deposit actions (create + confirm).
  The customer pays a UNIQUE amount to the owner's Pay ID, then submits the Binance
  C2C Order ID. We sync history, resolve the row for this panel+order_id, validate, and
  atomically credit the wallet (+ tiered bonus). Personal-account reconciliation — NOT a
  merchant checkout.
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
type FailureResult = Extract<BinanceClaimResult, { ok: false }>;

const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SYNC_PAGES = 8;
const ORDER_ID_RETRY_DELAYS_MS = [0, 2_000, 4_000, 8_000] as const;
const ORDER_PENDING_MESSAGE = "Binance has not returned this Order ID yet. Please wait a moment and check again.";
const CREDIT_FAILURE_MESSAGE = "We found the payment, but could not complete the credit. Please try again.";

type DbErrorLike = { code?: string; message?: string; details?: string; hint?: string; stage?: string };
type OrderLookupResult =
  | { kind: "found"; tx: BinanceTx; repairedOrderId: boolean }
  | { kind: "not_found"; code: "ORDER_ID_NOT_IN_CACHE" }
  | { kind: "error"; code: "DATABASE_LOOKUP_FAILURE"; dbCode?: string; message: string };

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

function toDbErrorLike(error: unknown): DbErrorLike {
  if (!error || typeof error !== "object") return {};
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.code === "string" ? e.code : undefined,
    message: typeof e.message === "string" ? e.message : undefined,
    details: typeof e.details === "string" ? e.details : undefined,
    hint: typeof e.hint === "string" ? e.hint : undefined,
    stage: typeof e.stage === "string" ? e.stage : undefined,
  };
}

function logStage(event: string, payload: Record<string, unknown>): void {
  console.info(`[binance-pay] ${event}`, payload);
}

function manualFailure(
  code: FailureResult['code'],
  message: string,
  logPayload: Record<string, unknown>
): FailureResult {
  logStage("manual-check-failed", { code, ...logPayload });
  return { ok: false, code, message };
}

function mapSyncError(error: unknown): FailureResult {
  if (error instanceof BinanceApiError) {
    const code = error.binanceCode ?? "";
    const msg = String(error.binanceMessage ?? error.message ?? "").toLowerCase();
    if (error.httpStatus === 451) {
      return {
        ok: false,
        code: "BINANCE_REGION_RESTRICTED",
        message: "Binance Pay verification is unavailable from the current server region.",
      };
    }
    if (code === "BINANCE_NOT_CONFIGURED") {
      return { ok: false, code: "BINANCE_NOT_CONFIGURED", message: "Binance Pay is not configured for this panel." };
    }
    if (error.kind === "auth" || code === "-2008" || code === "-2014" || code === "-2015" || /invalid api[- ]?key|api key|permission|unauthorized|signature/.test(msg)) {
      return { ok: false, code: "BINANCE_AUTH_FAILURE", message: "Binance rejected authentication for this request." };
    }
    return { ok: false, code: "BINANCE_API_FAILURE", message: "Could not query Binance right now. Please try again shortly." };
  }
  const dbErr = toDbErrorLike(error);
  if (dbErr.code || dbErr.stage) {
    return { ok: false, code: "DATABASE_WRITE_FAILURE", message: CREDIT_FAILURE_MESSAGE };
  }
  return { ok: false, code: "DATABASE_WRITE_FAILURE", message: CREDIT_FAILURE_MESSAGE };
}

function notConfigured(): FailureResult {
  return { ok: false, code: "BINANCE_NOT_CONFIGURED", message: "Binance Pay is not configured for this panel." };
}

function orderIdPending(): FailureResult {
  return { ok: false, code: "ORDER_PENDING_BINANCE_HISTORY", pending: true, message: ORDER_PENDING_MESSAGE };
}

function normalizeOrderId(input: string): string {
  return String(input ?? "").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findOrderById(
  admin: SupabaseClient,
  panelId: string,
  orderId: string
): Promise<OrderLookupResult> {
  const primary = await admin
    .from("binance_pay_transactions")
    .select(TX_COLS)
    .eq("panel_id", panelId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (primary.error && primary.error.code !== "PGRST116") {
    // Missing `order_id` column on production should fall back to raw_payload lookup.
    if (primary.error.code !== "42703") {
      return {
        kind: "error",
        code: "DATABASE_LOOKUP_FAILURE",
        dbCode: primary.error.code,
        message: primary.error.message,
      };
    }
  }

  if (primary.data) {
    return { kind: "found", tx: primary.data as BinanceTx, repairedOrderId: false };
  }

  const compat = await admin
    .from("binance_pay_transactions")
    .select("panel_id, transaction_id, order_type, transaction_time, amount, currency, receiver_binance_id")
    .eq("panel_id", panelId)
    .filter("raw_payload->>orderId", "eq", orderId)
    .maybeSingle();

  if (compat.error && compat.error.code !== "PGRST116") {
    return {
      kind: "error",
      code: "DATABASE_LOOKUP_FAILURE",
      dbCode: compat.error.code,
      message: compat.error.message,
    };
  }

  if (!compat.data) {
    return { kind: "not_found", code: "ORDER_ID_NOT_IN_CACHE" };
  }

  const tx = {
    transaction_id: String((compat.data as Record<string, unknown>).transaction_id ?? ""),
    order_id: orderId,
    order_type: String((compat.data as Record<string, unknown>).order_type ?? ""),
    transaction_time: String((compat.data as Record<string, unknown>).transaction_time ?? ""),
    amount: String((compat.data as Record<string, unknown>).amount ?? "0"),
    currency: String((compat.data as Record<string, unknown>).currency ?? "").toUpperCase(),
    receiver_binance_id: (compat.data as Record<string, unknown>).receiver_binance_id == null
      ? null
      : String((compat.data as Record<string, unknown>).receiver_binance_id),
  } satisfies BinanceTx;

  const repair = await admin
    .from("binance_pay_transactions")
    .update({ order_id: orderId })
    .eq("panel_id", panelId)
    .eq("transaction_id", tx.transaction_id)
    .is("order_id", null)
    .select("transaction_id")
    .maybeSingle();

  if (repair.error && repair.error.code !== "PGRST116" && repair.error.code !== "42703") {
    return {
      kind: "error",
      code: "DATABASE_LOOKUP_FAILURE",
      dbCode: repair.error.code,
      message: repair.error.message,
    };
  }

  return { kind: "found", tx, repairedOrderId: Boolean(repair.data) };
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
        `Pay within ${EXPIRY_MINUTES} minutes, then paste the Binance Order ID shown in your Binance C2C payment details.`,
      ],
    },
  };
}

async function loadOpenIntent(
  admin: SupabaseClient, panelId: string, paymentId: string, customerId: string
): Promise<PendingIntent | { error: FailureResult }> {
  const { data: payment } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, amount, binance_payable, status, gateway, created_at")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) {
    return { error: { ok: false, code: "DEPOSIT_NOT_OPEN", message: "Deposit request not found." } };
  }
  if (!paymentBelongsToRequestScope(payment, panelId, customerId)) {
    return { error: { ok: false, code: "DEPOSIT_NOT_OPEN", message: "Deposit request not found." } };
  }
  if (payment.status === "completed") return { error: { ok: false, code: "PAYMENT_ALREADY_CREDITED", message: "This deposit has already been credited." } };
  if (payment.status !== "pending") return { error: { ok: false, code: "DEPOSIT_NOT_OPEN", message: `This deposit can't be processed (status: ${payment.status}).` } };
  if (Date.now() > new Date(payment.created_at as string).getTime() + EXPIRY_MINUTES * 60_000) {
    return { error: { ok: false, code: "DEPOSIT_NOT_OPEN", message: `This deposit expired (${EXPIRY_MINUTES}-minute window). Start a new deposit and pay again.` } };
  }
  return {
    id: payment.id as string,
    customer_id: payment.customer_id as string,
    amount: String(payment.amount),
    binance_payable: payment.binance_payable != null ? String(payment.binance_payable) : null,
    created_at: payment.created_at as string,
  };
}

/** Manual verification: the customer pastes a Binance Order ID and we retry history
 *  lookups before completing the atomic claim + credit. */
export async function claimBinancePayment(
  panelId: string,
  paymentId: string,
  orderIdInput: string
): Promise<BinanceClaimResult> {
  const t0 = Date.now();
  const maskedPanelId = maskValue(panelId);
  const maskedPaymentId = maskValue(paymentId);
  const submittedOrderId = normalizeOrderId(orderIdInput);
  if (!submittedOrderId) {
    return manualFailure("ORDER_ID_NOT_FOUND", "That doesn't look like a Binance Order ID.", {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      elapsedMs: Date.now() - t0,
    });
  }

  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, code: "AUTH", message: "Please log in." };

  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("customer_accounts").select("id").eq("panel_id", panelId).eq("user_id", user.id).maybeSingle();
  if (!acct) return { ok: false, code: "NO_ACCOUNT", message: "No account found on this panel." };

  const loaded = await loadOpenIntent(admin, panelId, paymentId, acct.id as string);
  if ("error" in loaded) {
    return manualFailure(loaded.error.code, loaded.error.message, {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      elapsedMs: Date.now() - t0,
    });
  }
  const intent = loaded;
  const creds = await loadActiveBinanceCredentials(panelId);
  if (!creds.ok) {
    const out = notConfigured();
    return manualFailure(out.code, out.message, {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      elapsedMs: Date.now() - t0,
    });
  }
  const { startTime, endTime } = paymentWindowMs(intent);

  logStage("order-lookup-start", {
    panelId: maskedPanelId,
    paymentId: maskedPaymentId,
    orderId: maskValue(submittedOrderId),
    windowStart: new Date(startTime).toISOString(),
    windowEnd: new Date(endTime).toISOString(),
    elapsedMs: Date.now() - t0,
  });

  const expectedUid = (creds.config.binanceUid ?? "").trim();
  let tx: BinanceTx | null = null;

  for (let attempt = 0; attempt < ORDER_ID_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(ORDER_ID_RETRY_DELAYS_MS[attempt]);
    }
    try {
      const syncStart = Date.now();
      const syncRes = await syncPanelBinanceHistory(panelId, { startTime, endTime, maxPages: MAX_SYNC_PAGES });
      logStage("sync-complete", {
        panelId: maskedPanelId,
        paymentId: maskedPaymentId,
        orderId: maskValue(submittedOrderId),
        synced: syncRes.synced,
        attempt,
        elapsedMs: Date.now() - syncStart,
      });
    } catch (error) {
      const mapped = mapSyncError(error);
      const dbErr = toDbErrorLike(error);
      return manualFailure(mapped.code, mapped.message, {
        panelId: maskedPanelId,
        paymentId: maskedPaymentId,
        orderId: maskValue(submittedOrderId),
        dbCode: dbErr.code ?? null,
        dbStage: dbErr.stage ?? null,
        attempt,
        elapsedMs: Date.now() - t0,
      });
    }

    const lookup = await findOrderById(admin, panelId, submittedOrderId);
    if (lookup.kind === "error") {
      logStage("order-lookup-result", {
        panelId: maskedPanelId,
        paymentId: maskedPaymentId,
        orderFound: false,
        internalCode: lookup.code,
        dbCode: lookup.dbCode ?? null,
        attempt,
        elapsedMs: Date.now() - t0,
      });
      return manualFailure("DATABASE_LOOKUP_FAILURE", CREDIT_FAILURE_MESSAGE, {
        panelId: maskedPanelId,
        paymentId: maskedPaymentId,
        dbCode: lookup.dbCode ?? null,
        attempt,
        elapsedMs: Date.now() - t0,
      });
    }
    if (lookup.kind === "found") {
      tx = lookup.tx;
      logStage("order-lookup-result", {
        panelId: maskedPanelId,
        paymentId: maskedPaymentId,
        orderFound: true,
        repairedOrderId: lookup.repairedOrderId,
        attempt,
        elapsedMs: Date.now() - t0,
      });
      break;
    }

    logStage("order-lookup-result", {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      orderFound: false,
      internalCode: lookup.code,
      attempt,
      elapsedMs: Date.now() - t0,
    });
  }

  if (!tx) {
    const pending = orderIdPending();
    return manualFailure(pending.code, pending.message, {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      internalCode: "ORDER_ID_NOT_IN_CACHE",
      elapsedMs: Date.now() - t0,
    });
  }

  if (String(tx.order_id ?? "") !== submittedOrderId) {
    return manualFailure("ORDER_ID_NOT_FOUND", "That Binance Order ID was not found in this panel's history.", {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      elapsedMs: Date.now() - t0,
    });
  }

  const fail = validateTx(tx, intent, {
    expectedUid,
    requirePayableMatch: true,
    windowStartMs: startTime,
    windowEndMs: endTime,
  });
  if (fail) {
    logStage("validation-result", {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      orderFound: true,
      validationField: fail.code,
      elapsedMs: Date.now() - t0,
    });
    return manualFailure(fail.code as Exclude<BinanceClaimResult["code"], "PAYMENT_CONFIRMED">, fail.message, {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      validationField: fail.code,
      elapsedMs: Date.now() - t0,
    });
  }

  logStage("validation-result", {
    panelId: maskedPanelId,
    paymentId: maskedPaymentId,
    orderFound: true,
    validationField: "ok",
    elapsedMs: Date.now() - t0,
  });

  logStage("credit-start", {
    panelId: maskedPanelId,
    paymentId: maskedPaymentId,
    elapsedMs: Date.now() - t0,
  });

  const creditRes = await creditMatch(admin, intent, tx, creds.config ?? null);
  logStage("credit-result", {
    panelId: maskedPanelId,
    paymentId: maskedPaymentId,
    internalCode: creditRes.code,
    elapsedMs: Date.now() - t0,
  });

  if (creditRes.ok) return creditRes;
  if (creditRes.code === "PAYMENT_ALREADY_CREDITED") {
    return { ...creditRes, message: "Payment was already confirmed and credited." };
  }
  if (creditRes.code === "DATABASE_WRITE_FAILURE" || creditRes.code === "PAYMENT_CREDIT_FAILURE") {
    return manualFailure(creditRes.code, CREDIT_FAILURE_MESSAGE, {
      panelId: maskedPanelId,
      paymentId: maskedPaymentId,
      elapsedMs: Date.now() - t0,
    });
  }

  return creditRes;
}
