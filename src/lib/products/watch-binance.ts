"use server";

/**
 * Direct Watch payment via Binance Pay — Innvil's OWN platform-level
 * Binance account (super admin connects it under Platform payments →
 * Binance Pay, `platform_payment_gateways` gateway='binance_pay'), verified
 * by the customer submitting their Binance transaction/order id. Mirrors
 * the existing PANEL-level Binance Pay claim-by-transaction-id shape
 * (`actions/binance-pay.ts`), but reuses only the genuinely gateway-
 * agnostic piece — the raw Binance API client (`getPayTransactions`) — with
 * fresh, simpler platform-scoped matching against `platform_deposits`
 * rather than the panel-scoped `payments`/`binance_pay_transactions` cache.
 *
 * v1 simplification, stated plainly: no unique-payable-amount anti-theft
 * enhancement (the panel-level flow's later refinement) — this is the
 * original, simpler "pay the exact price, submit the transaction id"
 * shape. A duplicate/reused transaction id is still rejected via the DB's
 * own partial unique index (migration 0068), so a transaction can never
 * claim two different Watch deposits.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { getPlatformGatewayContext } from "@/src/lib/payments/platform";
import { getPayTransactions, BinanceApiError, type BinanceSecrets } from "@/src/lib/payments/binance";
import { activateWatchEntitlement } from "./ownership";
import { watchPlanOptions, type WatchPlanDisplayName, watchTierFromDisplayName } from "./watch-plans";
import { WATCH_PRODUCT_SLUG } from "./watch";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const ACCEPTED_ORDER_TYPES = new Set(["C2C", "PAY"]);
const ACCEPTED_ASSET = "USDT";

export interface WatchBinanceDepositInfo {
  depositId: string;
  payId: string;
  qrImage: string | null;
  amount: number;
}

/** Starts a direct Watch Binance Pay deposit — returns the amount to pay
 *  and Innvil's own Pay ID (never a panel owner's). */
export async function createWatchBinanceDeposit(planName: Exclude<WatchPlanDisplayName, "Enterprise">): Promise<Result<WatchBinanceDepositInfo>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  const tier = watchTierFromDisplayName(planName);
  const price = watchPlanOptions().find((o) => o.tier === tier)?.price;
  if (!price) return { ok: false, error: "Unknown plan." };

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Innvil Watch is not available right now." };

  const ctx = await getPlatformGatewayContext("binance_pay");
  if (!ctx || !ctx.config.payId || !ctx.secrets.apiKey || !ctx.secrets.apiSecret) {
    return { ok: false, error: "Binance Pay isn't fully configured yet. Please contact support." };
  }

  const { data: deposit, error } = await admin
    .from("platform_deposits")
    .insert({
      owner_id: user.id,
      panel_id: null,
      gateway: "binance_pay",
      purpose: "watch_subscription",
      product_id: product.id,
      plan: tier,
      paid_amount: price,
      credit_amount: price,
      currency: "USD",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !deposit) return { ok: false, error: error?.message ?? "Could not start the payment." };

  return {
    ok: true,
    data: { depositId: deposit.id, payId: ctx.config.payId, qrImage: ctx.config.qrImage || null, amount: price },
  };
}

/** Verifies a submitted Binance transaction/order id against Innvil's own
 *  Pay history and, on a genuine match, activates the Watch entitlement.
 *  Always the server-verified path — never trusts a client "I paid" claim
 *  by itself. */
export async function claimWatchBinancePayment(depositId: string, transactionId: string): Promise<Result<null>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  const txId = transactionId.trim();
  if (!txId) return { ok: false, error: "Enter the transaction/order id from your Binance app." };

  const { data: deposit } = await admin
    .from("platform_deposits")
    .select("id, owner_id, status, gateway, purpose, paid_amount, plan")
    .eq("id", depositId)
    .maybeSingle();
  if (!deposit || deposit.owner_id !== user.id) return { ok: false, error: "Payment not found." };
  if (deposit.gateway !== "binance_pay" || deposit.purpose !== "watch_subscription") return { ok: false, error: "This isn't a Binance Watch payment." };
  if (deposit.status === "completed") return { ok: true, data: null }; // already activated -- idempotent

  const ctx = await getPlatformGatewayContext("binance_pay");
  if (!ctx || !ctx.secrets.apiKey || !ctx.secrets.apiSecret) return { ok: false, error: "Binance Pay isn't configured." };

  const secrets: BinanceSecrets = { apiKey: ctx.secrets.apiKey, apiSecret: ctx.secrets.apiSecret };
  let records;
  try {
    records = await getPayTransactions(secrets, { limit: 100 });
  } catch (e) {
    if (e instanceof BinanceApiError) return { ok: false, error: "Couldn't reach Binance right now. Try again in a moment." };
    return { ok: false, error: "Couldn't verify the payment right now." };
  }

  const match = records.find((r) => r.transactionId === txId);
  if (!match) return { ok: false, error: "That transaction wasn't found yet — it can take a minute to appear. Try again shortly." };
  if (!ACCEPTED_ORDER_TYPES.has(match.orderType)) return { ok: false, error: "That transaction isn't a supported payment type." };
  if (match.currency !== ACCEPTED_ASSET) return { ok: false, error: "Payment must be sent as USDT." };
  const received = Number(match.amount);
  if (!(received > 0) || received < Number(deposit.paid_amount)) {
    return { ok: false, error: "The received amount doesn't match this plan's price." };
  }

  // Atomic claim: the partial unique index on binance_tx_id (migration 0068)
  // means a transaction id already used by ANY deposit fails this update
  // with a conflict, caught below -- a transaction can never activate two
  // Watch subscriptions.
  const { data: claimed, error: claimError } = await admin
    .from("platform_deposits")
    .update({ status: "completed", binance_tx_id: txId })
    .eq("id", deposit.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) {
    if (claimError.code === "23505") return { ok: false, error: "That transaction id has already been used." };
    return { ok: false, error: "Could not record the payment. Please try again." };
  }
  if (!claimed) return { ok: true, data: null }; // lost the race to another concurrent claim -- already completed

  await activateWatchEntitlement(admin, deposit.owner_id as string, deposit.plan as string, deposit.id as string);
  return { ok: true, data: null };
}
