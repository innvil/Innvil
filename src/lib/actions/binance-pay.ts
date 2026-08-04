"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getGatewayContext } from "@/src/lib/payments";
import { syncPanelBinanceHistory } from "@/src/lib/payments/binance-sync";
import { resolveGatewayDiscountPct } from "@/src/lib/actions/payments";
import { round4 } from "@/src/lib/money";

/* =========================================================
   Binance Pay — customer deposit (create + verify by transaction id).
   The customer pays the owner's Binance Pay ID, then submits the transaction id. We
   pull the owner's Pay history, match + validate the transaction, and credit the
   wallet. Personal-account reconciliation — NOT a merchant checkout.
   Phase 1: accepted asset = USDT, credited 1:1 into the panel wallet.
   ========================================================= */

const ACCEPTED_ORDER_TYPES = new Set(["C2C", "PAY"]);
const ACCEPTED_ASSET = "USDT";
const EXPIRY_MINUTES = 10;

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
  amount: number;
  asset: string; // "USDT"
  /** ISO time the deposit request expires (pay + verify within this window). */
  expiresAt: string;
  instructions: string[];
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

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

  const ctx = await getGatewayContext(panelId, "binance_pay");
  if (!ctx) return { ok: false, error: "Binance Pay isn't set up on this panel." };
  const payId = (ctx.config.payId ?? "").trim();
  if (!payId || !ctx.secrets.apiKey || !ctx.secrets.apiSecret) {
    return { ok: false, error: "Binance Pay isn't fully configured yet." };
  }
  const min = minTopup(ctx.config);
  if (amt < min) return { ok: false, error: `Minimum Binance Pay deposit is ${min.toFixed(2)} ${ACCEPTED_ASSET}.` };

  const currency = readPanelCurrency(panel.settings);
  const { data: pay, error } = await admin
    .from("payments")
    .insert({ panel_id: panelId, customer_id: acct.id, method: "Binance Pay", amount: amt, currency, status: "pending", gateway: "binance_pay" })
    .select("id, created_at")
    .single();
  if (error || !pay) return { ok: false, error: error?.message ?? "Could not start the deposit." };

  const expiresAt = new Date(new Date(pay.created_at as string).getTime() + EXPIRY_MINUTES * 60_000).toISOString();
  return {
    ok: true,
    data: {
      paymentId: pay.id as string,
      payId,
      qrImage: (ctx.config.qrImage ?? "").trim() || null,
      amount: amt,
      asset: ACCEPTED_ASSET,
      expiresAt,
      instructions: [
        `Open Binance → Pay and send exactly ${amt} ${ACCEPTED_ASSET} to Pay ID ${payId}.`,
        "Use Binance Pay — NOT an on-chain/blockchain withdrawal.",
        `Do this within ${EXPIRY_MINUTES} minutes, then copy the Binance Pay transaction ID (looks like M_P_…).`,
        "Paste the transaction ID below and tap Verify.",
      ],
    },
  };
}

export type BinanceClaimResult =
  | { ok: true; code: "PAYMENT_CONFIRMED"; message: string; credited: number; received: number }
  | { ok: false; code: string; message: string; pending?: boolean };

/** Verify a submitted Binance Pay transaction id and credit the wallet. */
export async function claimBinancePayment(
  panelId: string,
  paymentId: string,
  transactionId: string
): Promise<BinanceClaimResult> {
  const txId = String(transactionId || "").trim();
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(txId)) {
    return { ok: false, code: "INVALID_TRANSACTION_ID", message: "That doesn't look like a Binance Pay transaction ID." };
  }

  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, code: "AUTH", message: "Please log in." };

  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("customer_accounts").select("id").eq("panel_id", panelId).eq("user_id", user.id).maybeSingle();
  if (!acct) return { ok: false, code: "NO_ACCOUNT", message: "No account found on this panel." };

  const { data: payment } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, amount, currency, status, gateway, binance_tx_id, created_at")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment || payment.customer_id !== acct.id || payment.panel_id !== panelId || payment.gateway !== "binance_pay") {
    return { ok: false, code: "DEPOSIT_NOT_FOUND", message: "Deposit request not found." };
  }
  if (payment.status === "completed") {
    return { ok: false, code: "ALREADY_PAID", message: "This deposit has already been credited." };
  }
  if (payment.status !== "pending") {
    return { ok: false, code: "DEPOSIT_NOT_OPEN", message: `This deposit can't be processed (status: ${payment.status}).` };
  }

  // 10-minute deposit window: pay + verify within it.
  const createdMs = new Date(payment.created_at as string).getTime();
  const expiresMs = createdMs + EXPIRY_MINUTES * 60_000;
  if (Date.now() > expiresMs) {
    return { ok: false, code: "EXPIRED", message: `This deposit expired (${EXPIRY_MINUTES}-minute window). Start a new deposit and pay again.` };
  }

  // Reject a transaction id already used by any deposit (anti-replay, before we even sync).
  const { data: usedElsewhere } = await admin
    .from("payments").select("id").eq("binance_tx_id", txId).maybeSingle();
  if (usedElsewhere) {
    return { ok: false, code: "TRANSACTION_ALREADY_USED", message: "This Binance transaction has already been used." };
  }

  // Find the transaction locally; if missing, sync the owner's history once and retry.
  const loadTx = async () =>
    (await admin.from("binance_pay_transactions")
      .select("order_type, transaction_time, amount, currency, receiver_binance_id")
      .eq("panel_id", panelId).eq("transaction_id", txId).maybeSingle()).data;
  let tx = await loadTx();
  if (!tx) {
    try { await syncPanelBinanceHistory(panelId); } catch { /* surface as not-found below */ }
    tx = await loadTx();
  }
  if (!tx) {
    return { ok: false, code: "PAYMENT_NOT_FOUND", pending: true, message: "That transaction hasn't shown up in Binance yet. Double-check the ID and try again in a few seconds." };
  }

  const ctx = await getGatewayContext(panelId, "binance_pay");
  const expectedUid = (ctx?.config.binanceUid ?? "").trim();
  const policy = (ctx?.config.amountPolicy ?? "").trim().toLowerCase() === "exact" ? "exact" : "credit_actual";

  const received = round4(Number(tx.amount));
  const expected = round4(Number(payment.amount));

  if (!Number.isFinite(received) || received <= 0) {
    return { ok: false, code: "NOT_INCOMING", message: "That transaction isn't an incoming payment." };
  }
  if (String(tx.currency).toUpperCase() !== ACCEPTED_ASSET) {
    return { ok: false, code: "WRONG_CURRENCY", message: `That transaction used ${tx.currency}, but ${ACCEPTED_ASSET} is required.` };
  }
  if (!ACCEPTED_ORDER_TYPES.has(String(tx.order_type).toUpperCase())) {
    return { ok: false, code: "WRONG_TRANSACTION_TYPE", message: "That isn't a supported Binance Pay transfer." };
  }
  if (expectedUid && tx.receiver_binance_id && String(tx.receiver_binance_id) !== expectedUid) {
    return { ok: false, code: "WRONG_RECIPIENT", message: "That payment was not received by this panel's Binance account." };
  }
  // Time window: reject transactions from before this deposit was created (minus small skew).
  const txTime = new Date(tx.transaction_time as string).getTime();
  const earliest = new Date(payment.created_at as string).getTime() - 5 * 60 * 1000;
  if (Number.isFinite(txTime) && txTime < earliest) {
    return { ok: false, code: "PAYMENT_OUTSIDE_TIME_WINDOW", message: "That transaction is older than this deposit request. Start a new deposit and pay again, or contact support." };
  }

  // Exact policy: a mismatch is NOT auto-credited — leave it pending for owner review.
  if (policy === "exact" && received !== expected) {
    const kind = received < expected ? "UNDERPAID" : "OVERPAID";
    return {
      ok: false, code: kind,
      message: `Transaction found, but ${received} ${ACCEPTED_ASSET} was received instead of ${expected} ${ACCEPTED_ASSET}. Contact support to resolve it.`,
    };
  }

  // Base = the amount the tier bonus is calculated on (received for credit_actual,
  // the requested amount for exact). Bonus reuses the panel's top-up discount tiers.
  const base = policy === "credit_actual" ? received : expected;
  const bonusPct = await resolveGatewayDiscountPct("binance_pay", ctx?.config ?? null, base);
  const bonus = bonusPct != null ? round4((base * bonusPct) / 100) : 0;
  const credit = round4(base + bonus);

  // Claim the deposit atomically: the unique index on binance_tx_id ensures one Binance
  // tx credits at most one deposit even under concurrent submits.
  const { data: claimed, error: claimErr } = await admin
    .from("payments")
    .update({ status: "completed", binance_tx_id: txId, amount: base, bonus_amount: bonus })
    .eq("id", paymentId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimErr) {
    if ((claimErr as { code?: string }).code === "23505") {
      return { ok: false, code: "TRANSACTION_ALREADY_USED", message: "This Binance transaction has already been used." };
    }
    return { ok: false, code: "INTERNAL_ERROR", message: "Could not verify the payment right now." };
  }
  if (!claimed) {
    return { ok: false, code: "DEPOSIT_NOT_OPEN", message: "This deposit was already processed." };
  }

  const { error: creditErr } = await admin.rpc("apply_balance_change", {
    p_customer: acct.id,
    p_amount: credit,
    p_type: "deposit",
    p_reason: `Binance Pay ${txId}`,
  });
  if (creditErr) {
    // Roll back the claim so the customer can retry.
    await admin.from("payments").update({ status: "pending", binance_tx_id: null, bonus_amount: 0 }).eq("id", paymentId);
    return { ok: false, code: "INTERNAL_ERROR", message: "Payment matched, but crediting failed. Please try again." };
  }

  return {
    ok: true, code: "PAYMENT_CONFIRMED",
    message: bonus > 0
      ? `${credit} ${ACCEPTED_ASSET} added to your balance (${base} + ${bonus} bonus).`
      : `${credit} ${ACCEPTED_ASSET} added to your balance.`,
    credited: credit, received,
  };
}
