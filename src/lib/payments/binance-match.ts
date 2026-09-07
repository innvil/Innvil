import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asNonNegativeDecimal, toNumberFromDecimal } from "@/src/lib/payments/binance-amounts";
import { round4 } from "@/src/lib/money";

/* =========================================================
   Binance Pay — shared match + credit core (no user session required).
   Reused by the customer confirm actions (binance-pay.ts) and the cron poller
   (binance-poll.ts). Not a "use server" module, so it can export sync helpers.
   ========================================================= */

export const ACCEPTED_ORDER_TYPES = new Set(["C2C"]);
export const ACCEPTED_ASSET = "USDT";
export const EXPIRY_MINUTES = 10;
export const TX_COLS = "transaction_id, order_id, order_type, transaction_time, amount, currency, receiver_binance_id";

export interface PendingIntent {
  id: string;
  customer_id: string;
  amount: string;
  binance_payable: string | null;
  created_at: string;
}
export interface BinanceTx {
  transaction_id: string;
  order_id: string | null;
  order_type: string;
  transaction_time: string;
  amount: string;
  currency: string;
  receiver_binance_id: string | null;
}
export type BinanceClaimResult =
  | { ok: true; code: "PAYMENT_CONFIRMED"; message: string; credited: number; received: number }
  | { ok: false; code:
      | "PAYMENT_ALREADY_CREDITED"
      | "TRANSACTION_ALREADY_USED"
      | "AUTH"
      | "NO_ACCOUNT"
      | "ORDER_PENDING_BINANCE_HISTORY"
      | "ORDER_ID_NOT_IN_CACHE"
      | "ORDER_ID_NOT_FOUND"
      | "ORDER_ID_ALREADY_USED"
      | "AMOUNT_MISMATCH"
      | "CURRENCY_MISMATCH"
      | "WRONG_RECEIVER"
      | "TRANSACTION_OUTSIDE_WINDOW"
      | "DATABASE_WRITE_FAILURE"
      | "DATABASE_LOOKUP_FAILURE"
      | "PAYMENT_CREDIT_FAILURE"
      | "BINANCE_AUTH_FAILURE"
      | "BINANCE_REGION_RESTRICTED"
      | "BINANCE_API_FAILURE"
      | "BINANCE_NOT_CONFIGURED"
      | "INVALID_ORDER_ID"
      | "DEPOSIT_NOT_OPEN"
      | "INTERNAL_ERROR"; message: string; pending?: boolean };

interface CreditLogContext {
  maskedPanelId?: string | null;
  maskedPaymentId?: string | null;
  paymentStatusBefore?: string;
  discountPct?: number | null;
}

function logCredit(event: string, payload: Record<string, unknown>): void {
  console.info(`[binance-pay] ${event}`, payload);
}

function isSchemaCompatibilityError(code: string): boolean {
  return code === "PGRST202" || code === "PGRST205" || code === "PGRST204" || code === "42703";
}

function isAlreadyClaimedCode(code: string): boolean {
  return code === "PAYMENT_ALREADY_CREDITED" || code === "ORDER_ID_ALREADY_USED" || code === "TRANSACTION_ALREADY_USED";
}

function hasQueryBuilder(client: unknown): client is {
  from: SupabaseClient["from"];
} {
  return Boolean(client && typeof (client as { from?: unknown }).from === "function");
}

export function normalizeEnteredTransactionId(input: string): string {
  return String(input || "").normalize("NFKC").trim().replace(/\s+/g, "");
}

export function isValidTransactionIdFormat(value: string): boolean {
  return /^[A-Za-z0-9_-]{5,128}$/.test(value);
}

export function matchesTransactionId(entered: string, binanceTransactionId: string): boolean {
  return normalizeEnteredTransactionId(entered) === normalizeEnteredTransactionId(binanceTransactionId);
}

function normalizeDecimalStrict(input: string): { canon: string; scale: number } | null {
  const s = String(input ?? "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [rawInt, rawFrac = ""] = body.split(".");
  if (rawFrac.length > 18) return null;
  const intPart = rawInt.replace(/^0+(?=\d)/, "") || "0";
  const fracPart = rawFrac.replace(/0+$/, "");
  const canon = `${neg ? "-" : ""}${intPart}${fracPart ? `.${fracPart}` : ""}`;
  return { canon, scale: rawFrac.length };
}

function isPositiveDecimal(input: string): boolean {
  const n = normalizeDecimalStrict(input);
  if (!n) return false;
  return n.canon !== "0" && n.canon !== "-0" && !n.canon.startsWith("-");
}

function decimalEquals(a: string, b: string): boolean {
  const da = normalizeDecimalStrict(a);
  const db = normalizeDecimalStrict(b);
  if (!da || !db) return false;
  return da.canon === db.canon;
}

function decimalToNumber(input: string): number {
  const n = normalizeDecimalStrict(input);
  if (!n) throw new Error(`Invalid decimal amount: ${input}`);
  const parsed = Number(n.canon);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric amount: ${input}`);
  return parsed;
}

/** Pick a unique payable amount = base + a tiny 0.0001-step tail, unique among the
 *  panel's still-open Binance deposits (so a payment maps to one intent by amount). */
export async function pickPayable(admin: SupabaseClient, panelId: string, base: number): Promise<number> {
  const { data } = await admin
    .from("payments")
    .select("binance_payable")
    .eq("panel_id", panelId).eq("gateway", "binance_pay").eq("status", "pending")
    .not("binance_payable", "is", null);
  const taken = new Set(((data as Array<{ binance_payable: number }> | null) ?? []).map((p) => round4(Number(p.binance_payable)).toFixed(4)));
  for (let tail = 1; tail <= 9999; tail++) {
    const payable = round4(base + tail / 10000);
    if (!taken.has(payable.toFixed(4))) return payable;
  }
  return round4(base + Math.floor(Math.random() * 9999 + 1) / 10000); // fallback (extremely unlikely)
}

/** Validate a transaction against an intent. Returns null on a valid match, else a failure. */
export function validateTx(
  tx: BinanceTx,
  intent: PendingIntent,
  opts: { expectedUid: string; requirePayableMatch: boolean; windowStartMs: number; windowEndMs: number }
): { code: string; message: string } | null {
  if (!isPositiveDecimal(tx.amount)) return { code: "AMOUNT_MISMATCH", message: "That transaction isn't an incoming payment." };
  if (String(tx.currency).toUpperCase() !== ACCEPTED_ASSET) return { code: "CURRENCY_MISMATCH", message: `That transaction used ${tx.currency}, but ${ACCEPTED_ASSET} is required.` };
  if (String(tx.order_type).toUpperCase() !== "C2C") return { code: "ORDER_ID_NOT_FOUND", message: "No matching Binance Pay C2C transaction was found." };
  if (opts.expectedUid) {
    const got = String(tx.receiver_binance_id ?? "").trim();
    if (!got || got !== opts.expectedUid) {
      return { code: "WRONG_RECEIVER", message: "That payment was not received by this panel's Binance account." };
    }
  }
  if (!ACCEPTED_ORDER_TYPES.has(String(tx.order_type).toUpperCase())) {
    return { code: "ORDER_ID_NOT_FOUND", message: "No matching Binance Pay C2C transaction was found." };
  }

  const txTime = new Date(tx.transaction_time).getTime();
  if (!Number.isFinite(txTime) || txTime < opts.windowStartMs || txTime > opts.windowEndMs) {
    return { code: "TRANSACTION_OUTSIDE_WINDOW", message: "That transaction is outside the allowed verification time window for this deposit." };
  }

  if (opts.requirePayableMatch && intent.binance_payable != null && !decimalEquals(tx.amount, intent.binance_payable)) {
    return { code: "AMOUNT_MISMATCH", message: `That transaction amount does not match the exact required amount for this deposit.` };
  }
  return null;
}

/** Find an unused transaction matching this intent's unique payable amount. */
export async function findMatchingTx(
  admin: SupabaseClient,
  panelId: string,
  orderId: string
): Promise<BinanceTx | null> {
  const normalizedOrderId = normalizeEnteredTransactionId(orderId);
  if (!normalizedOrderId) return null;
  const { data } = await admin
    .from("binance_pay_transactions")
    .select(TX_COLS)
    .eq("panel_id", panelId)
    .eq("order_id", normalizedOrderId)
    .order("transaction_time", { ascending: false })
    .limit(1);
  for (const tx of ((data as BinanceTx[] | null) ?? [])) {
    return tx;
  }
  return null;
}

/**
 * Atomically claim `intent` for `tx` and credit the wallet (+ tiered bonus). The unique
 * indexes on payments.binance_order_id and payments.binance_tx_id guarantee one use per
 * Order ID and per transaction id.
 */
export async function creditMatch(
  admin: SupabaseClient,
  intent: PendingIntent,
  tx: BinanceTx,
  _gwConfig: Record<string, string> | null,
  logContext?: CreditLogContext
): Promise<BinanceClaimResult> {
  // Credit the exact Binance amount received (including the unique verification increment).
  const receivedDecimal = asNonNegativeDecimal(tx.amount, 4);
  const received = toNumberFromDecimal(receivedDecimal);
  const discountPct = Number.isFinite(logContext?.discountPct as number) ? Number(logContext?.discountPct) : 0;
  const safeDiscountPct = discountPct > 0 ? discountPct : 0;
  const bonusAmount = safeDiscountPct > 0 ? round4((received * safeDiscountPct) / 100) : 0;
  const bonusDecimal = asNonNegativeDecimal(bonusAmount, 4);
  const creditDecimal = asNonNegativeDecimal(received + bonusAmount, 4);
  const credit = toNumberFromDecimal(creditDecimal);

  let txAlreadyClaimed: boolean | null = null;
  let orderAlreadyClaimed: boolean | null = tx.order_id ? null : false;
  let precheckDbCode: string | null = null;

  if (hasQueryBuilder(admin)) {
    const claimedTxProbe = await admin.from("payments").select("id").eq("binance_tx_id", tx.transaction_id).neq("id", intent.id).limit(1).maybeSingle();
    if (claimedTxProbe.error) {
      precheckDbCode = claimedTxProbe.error.code ?? null;
    } else {
      txAlreadyClaimed = Boolean(claimedTxProbe.data);
    }

    if (tx.order_id) {
      const claimedOrderProbe = await admin.from("payments").select("id").eq("binance_order_id", tx.order_id).neq("id", intent.id).limit(1).maybeSingle();
      if (claimedOrderProbe.error) {
        precheckDbCode = precheckDbCode ?? claimedOrderProbe.error.code ?? null;
      } else {
        orderAlreadyClaimed = Boolean(claimedOrderProbe.data);
      }
    }
  }

  logCredit("credit-db-call", {
    paymentId: logContext?.maskedPaymentId ?? null,
    panelId: logContext?.maskedPanelId ?? null,
    rpc: "claim_binance_payment",
    paymentStatusBefore: logContext?.paymentStatusBefore ?? "unknown",
    transactionAlreadyClaimed: txAlreadyClaimed,
    orderAlreadyClaimed,
    dbCode: precheckDbCode,
  });

  const { data: claimCode, error: claimErr } = await admin.rpc("claim_binance_payment", {
    p_payment_id: intent.id,
    p_customer_id: intent.customer_id,
    p_order_id: tx.order_id ?? "",
    p_tx_id: tx.transaction_id,
    p_bonus_amount: bonusDecimal,
    p_credit_amount: creditDecimal,
    p_reason: `Binance Pay ${tx.order_id ?? tx.transaction_id}`,
  });

  logCredit("credit-db-result", {
    paymentId: logContext?.maskedPaymentId ?? null,
    panelId: logContext?.maskedPanelId ?? null,
    rpc: "claim_binance_payment",
    internalCode: claimCode ?? null,
    dbCode: claimErr?.code ?? null,
  });

  let effectiveCode = claimCode as string | null;
  let effectiveErr = claimErr;

  // Compatibility path: production may still have the pre-0040 function signature.
  if (effectiveErr && isSchemaCompatibilityError(String(effectiveErr.code ?? "").toUpperCase())) {
    console.warn("[binance-pay] legacy-credit-rpc-fallback", {
      paymentId: logContext?.maskedPaymentId ?? null,
      panelId: logContext?.maskedPanelId ?? null,
      dbCode: effectiveErr.code ?? null,
    });
    const legacy = await admin.rpc("claim_binance_payment", {
      p_payment_id: intent.id,
      p_customer_id: intent.customer_id,
      p_tx_id: tx.transaction_id,
      p_bonus_amount: bonusDecimal,
      p_credit_amount: creditDecimal,
      p_reason: `Binance Pay ${tx.order_id ?? tx.transaction_id}`,
    });

    logCredit("credit-db-result", {
      paymentId: logContext?.maskedPaymentId ?? null,
      panelId: logContext?.maskedPanelId ?? null,
      rpc: "claim_binance_payment_legacy_signature",
      internalCode: legacy.data ?? null,
      dbCode: legacy.error?.code ?? null,
    });

    effectiveCode = legacy.data as string | null;
    effectiveErr = legacy.error;
  }

  if (effectiveErr) {
    const code = String(effectiveErr.code ?? "").toUpperCase();
    const out = isSchemaCompatibilityError(code)
      ? { ok: false, code: "DATABASE_WRITE_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." } as const
      : { ok: false, code: "PAYMENT_CREDIT_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." } as const;
    logCredit("credit-failed", {
      paymentId: logContext?.maskedPaymentId ?? null,
      panelId: logContext?.maskedPanelId ?? null,
      rpc: "claim_binance_payment",
      internalCode: out.code,
      dbCode: effectiveErr.code ?? null,
      dbConstraint: (effectiveErr as { constraint?: string } | null)?.constraint ?? null,
      paymentStatusBefore: logContext?.paymentStatusBefore ?? "unknown",
      transactionAlreadyClaimed: txAlreadyClaimed,
      orderAlreadyClaimed,
    });
    return out;
  }
  if (effectiveCode === "PAYMENT_ALREADY_CREDITED") {
    return { ok: false, code: "PAYMENT_ALREADY_CREDITED", message: "Payment was already confirmed and credited." };
  }
  if (effectiveCode === "TRANSACTION_ALREADY_USED") {
    if (hasQueryBuilder(admin)) {
      const statusProbe = await admin.from("payments").select("status").eq("id", intent.id).maybeSingle();
      if (!statusProbe.error && statusProbe.data?.status === "completed") {
        return { ok: false, code: "PAYMENT_ALREADY_CREDITED", message: "Payment was already confirmed and credited." };
      }
    }
    return { ok: false, code: "TRANSACTION_ALREADY_USED", message: "This Binance transaction has already been used." };
  }
  if (effectiveCode === "ORDER_ID_ALREADY_USED") {
    return { ok: false, code: "ORDER_ID_ALREADY_USED", message: "This Binance Order ID has already been used." };
  }
  if (effectiveCode === "DEPOSIT_NOT_OPEN") {
    if (hasQueryBuilder(admin)) {
      const statusProbe = await admin.from("payments").select("status").eq("id", intent.id).maybeSingle();
      if (!statusProbe.error && statusProbe.data?.status === "completed") {
        return { ok: false, code: "PAYMENT_ALREADY_CREDITED", message: "Payment was already confirmed and credited." };
      }
    }
    return { ok: false, code: "DEPOSIT_NOT_OPEN", message: "We found the payment, but could not complete the credit. Please try again." };
  }
  if (effectiveCode === "CREDIT_FAILED") {
    logCredit("credit-failed", {
      paymentId: logContext?.maskedPaymentId ?? null,
      panelId: logContext?.maskedPanelId ?? null,
      rpc: "claim_binance_payment",
      internalCode: "PAYMENT_CREDIT_FAILURE",
      dbCode: null,
      dbConstraint: null,
      paymentStatusBefore: logContext?.paymentStatusBefore ?? "unknown",
      transactionAlreadyClaimed: txAlreadyClaimed,
      orderAlreadyClaimed,
    });
    return { ok: false, code: "PAYMENT_CREDIT_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." };
  }
  if (effectiveCode !== "OK") {
    const internalCode = isAlreadyClaimedCode(String(effectiveCode ?? ""))
      ? String(effectiveCode)
      : "PAYMENT_CREDIT_FAILURE";
    logCredit("credit-failed", {
      paymentId: logContext?.maskedPaymentId ?? null,
      panelId: logContext?.maskedPanelId ?? null,
      rpc: "claim_binance_payment",
      internalCode,
      dbCode: null,
      dbConstraint: null,
      paymentStatusBefore: logContext?.paymentStatusBefore ?? "unknown",
      transactionAlreadyClaimed: txAlreadyClaimed,
      orderAlreadyClaimed,
    });
    return { ok: false, code: "PAYMENT_CREDIT_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." };
  }

  return {
    ok: true, code: "PAYMENT_CONFIRMED",
    message: "Payment confirmed and credited.",
    credited: credit, received,
  };
}
