import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGatewayDiscountPct } from "@/src/lib/actions/payments";
import { round4 } from "@/src/lib/money";

/* =========================================================
   Binance Pay — shared match + credit core (no user session required).
   Reused by the customer confirm actions (binance-pay.ts) and the cron poller
   (binance-poll.ts). Not a "use server" module, so it can export sync helpers.
   ========================================================= */

export const ACCEPTED_ORDER_TYPES = new Set(["C2C", "PAY"]);
export const ACCEPTED_ASSET = "USDT";
export const EXPIRY_MINUTES = 10;
export const TX_COLS = "transaction_id, order_type, transaction_time, amount, currency, receiver_binance_id";

export interface PendingIntent {
  id: string;
  customer_id: string;
  amount: number;
  binance_payable: number | null;
  created_at: string;
}
export interface BinanceTx {
  transaction_id: string;
  order_type: string;
  transaction_time: string;
  amount: string;
  currency: string;
  receiver_binance_id: string | null;
}
export type BinanceClaimResult =
  | { ok: true; code: "PAYMENT_CONFIRMED"; message: string; credited: number; received: number }
  | { ok: false; code: string; message: string; pending?: boolean };

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
  opts: { expectedUid: string; requirePayableMatch: boolean }
): { code: string; message: string } | null {
  const received = round4(Number(tx.amount));
  if (!Number.isFinite(received) || received <= 0) return { code: "NOT_INCOMING", message: "That transaction isn't an incoming payment." };
  if (String(tx.currency).toUpperCase() !== ACCEPTED_ASSET) return { code: "WRONG_CURRENCY", message: `That transaction used ${tx.currency}, but ${ACCEPTED_ASSET} is required.` };
  if (!ACCEPTED_ORDER_TYPES.has(String(tx.order_type).toUpperCase())) return { code: "WRONG_TRANSACTION_TYPE", message: "That isn't a supported Binance Pay transfer." };
  if (opts.expectedUid && tx.receiver_binance_id && String(tx.receiver_binance_id) !== opts.expectedUid) {
    return { code: "WRONG_RECIPIENT", message: "That payment was not received by this panel's Binance account." };
  }
  const txTime = new Date(tx.transaction_time).getTime();
  const earliest = new Date(intent.created_at).getTime() - 5 * 60 * 1000;
  if (Number.isFinite(txTime) && txTime < earliest) {
    return { code: "PAYMENT_OUTSIDE_TIME_WINDOW", message: "That transaction is older than this deposit. Start a new deposit and pay again." };
  }
  if (opts.requirePayableMatch && intent.binance_payable != null && received !== round4(Number(intent.binance_payable))) {
    return { code: "AMOUNT_MISMATCH", message: `That transaction is for ${received} ${ACCEPTED_ASSET}, but this deposit expects exactly ${round4(Number(intent.binance_payable))} ${ACCEPTED_ASSET}.` };
  }
  return null;
}

/** Find an unused transaction matching this intent's unique payable amount. */
export async function findMatchingTx(
  admin: SupabaseClient,
  panelId: string,
  intent: PendingIntent,
  expectedUid: string
): Promise<BinanceTx | null> {
  if (intent.binance_payable == null) return null;
  const payable = round4(Number(intent.binance_payable));
  const { data } = await admin
    .from("binance_pay_transactions")
    .select(TX_COLS)
    .eq("panel_id", panelId)
    .eq("amount", payable)
    .order("transaction_time", { ascending: false })
    .limit(10);
  for (const tx of ((data as BinanceTx[] | null) ?? [])) {
    if (validateTx(tx, intent, { expectedUid, requirePayableMatch: true })) continue;
    const { data: used } = await admin.from("payments").select("id").eq("binance_tx_id", tx.transaction_id).maybeSingle();
    if (used) continue;
    return tx;
  }
  return null;
}

/**
 * Atomically claim `intent` for `tx` and credit the wallet (+ tiered bonus). The unique
 * index on payments.binance_tx_id guarantees a transaction credits at most one deposit.
 */
export async function creditMatch(
  admin: SupabaseClient,
  intent: PendingIntent,
  tx: BinanceTx,
  gwConfig: Record<string, string> | null
): Promise<BinanceClaimResult> {
  const received = round4(Number(tx.amount));
  const base = round4(Number(intent.amount)); // credit the requested top-up; the unique tail is a tiny margin
  const bonusPct = await resolveGatewayDiscountPct("binance_pay", gwConfig, base);
  const bonus = bonusPct != null ? round4((base * bonusPct) / 100) : 0;
  const credit = round4(base + bonus);

  const { data: claimed, error: claimErr } = await admin
    .from("payments")
    .update({ status: "completed", binance_tx_id: tx.transaction_id, bonus_amount: bonus })
    .eq("id", intent.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimErr) {
    if ((claimErr as { code?: string }).code === "23505") return { ok: false, code: "TRANSACTION_ALREADY_USED", message: "This Binance transaction has already been used." };
    return { ok: false, code: "INTERNAL_ERROR", message: "Could not verify the payment right now." };
  }
  if (!claimed) return { ok: false, code: "DEPOSIT_NOT_OPEN", message: "This deposit was already processed." };

  const { error: creditErr } = await admin.rpc("apply_balance_change", {
    p_customer: intent.customer_id,
    p_amount: credit,
    p_type: "deposit",
    p_reason: `Binance Pay ${tx.transaction_id}`,
  });
  if (creditErr) {
    await admin.from("payments").update({ status: "pending", binance_tx_id: null, bonus_amount: 0 }).eq("id", intent.id);
    return { ok: false, code: "INTERNAL_ERROR", message: "Payment matched, but crediting failed. Please try again." };
  }
  return {
    ok: true, code: "PAYMENT_CONFIRMED",
    message: bonus > 0 ? `${credit} ${ACCEPTED_ASSET} added to your balance (${base} + ${bonus} bonus).` : `${credit} ${ACCEPTED_ASSET} added to your balance.`,
    credited: credit, received,
  };
}
