import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGatewayDiscountPct } from "@/src/lib/actions/payments";
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
  gwConfig: Record<string, string> | null
): Promise<BinanceClaimResult> {
  const received = round4(decimalToNumber(tx.amount));
  const base = round4(decimalToNumber(intent.amount)); // credit the requested top-up; the unique tail is a tiny margin
  const bonusPct = await resolveGatewayDiscountPct("binance_pay", gwConfig, base);
  const bonus = bonusPct != null ? round4((base * bonusPct) / 100) : 0;
  const credit = round4(base + bonus);

  const { data: claimCode, error: claimErr } = await admin.rpc("claim_binance_payment", {
    p_payment_id: intent.id,
    p_customer_id: intent.customer_id,
    p_order_id: tx.order_id ?? "",
    p_tx_id: tx.transaction_id,
    p_bonus_amount: bonus,
    p_credit_amount: credit,
    p_reason: `Binance Pay ${tx.order_id ?? tx.transaction_id}`,
  });

  if (claimErr) {
    const code = String(claimErr.code ?? "").toUpperCase();
    if (code === "PGRST202" || code === "PGRST205" || code === "42703") {
      return { ok: false, code: "DATABASE_WRITE_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." };
    }
    return { ok: false, code: "PAYMENT_CREDIT_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." };
  }
  if (claimCode === "PAYMENT_ALREADY_CREDITED") {
    return { ok: false, code: "PAYMENT_ALREADY_CREDITED", message: "Payment was already confirmed and credited." };
  }
  if (claimCode === "ORDER_ID_ALREADY_USED") {
    return { ok: false, code: "ORDER_ID_ALREADY_USED", message: "This Binance Order ID has already been used." };
  }
  if (claimCode === "DEPOSIT_NOT_OPEN") {
    return { ok: false, code: "DEPOSIT_NOT_OPEN", message: "We found the payment, but could not complete the credit. Please try again." };
  }
  if (claimCode === "CREDIT_FAILED") {
    return { ok: false, code: "PAYMENT_CREDIT_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." };
  }
  if (claimCode !== "OK") {
    return { ok: false, code: "PAYMENT_CREDIT_FAILURE", message: "We found the payment, but could not complete the credit. Please try again." };
  }

  return {
    ok: true, code: "PAYMENT_CONFIRMED",
    message: "Payment confirmed and credited.",
    credited: credit, received,
  };
}
