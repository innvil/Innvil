"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";

/* =========================================================
   Binance Pay — owner review surface.
   Lists the panel's Binance deposits (esp. ones that didn't auto-credit — amount
   mismatch, wrong recipient, stuck pending) and the raw Pay history the server cached,
   so the owner can reconcile manually. Manual credit/cancel reuse commitPendingPayment /
   cancelPendingPayment (actions/payments.ts). Owner-auth + ownership enforced in code.
   ========================================================= */

async function ownsPanel(admin: SupabaseClient, userId: string, panelId: string): Promise<boolean> {
  const { data } = await admin.from("panels").select("id").eq("id", panelId).eq("owner_id", userId).maybeSingle();
  return !!data;
}

/** Resolve customer_account ids → { username, email } (best-effort). */
async function resolveCustomers(admin: SupabaseClient, panelId: string, ids: string[]) {
  const out = new Map<string, { username: string | null; email: string | null }>();
  if (!ids.length) return out;
  const { data: accts } = await admin.from("customer_accounts").select("id, user_id").eq("panel_id", panelId).in("id", ids);
  const userByAcct = new Map(((accts as Array<{ id: string; user_id: string }> | null) ?? []).map((a) => [a.id, a.user_id]));
  const uids = [...new Set(Array.from(userByAcct.values()))];
  const { data: profs } = await admin.from("profiles").select("id, display_name").in("id", uids);
  const nameByUid = new Map(((profs as Array<{ id: string; display_name: string | null }> | null) ?? []).map((p) => [p.id, p.display_name]));
  const emailByUid = new Map<string, string | null>();
  for (const uid of uids) {
    try { const { data } = await admin.auth.admin.getUserById(uid); emailByUid.set(uid, data.user?.email ?? null); }
    catch { emailByUid.set(uid, null); }
  }
  for (const [acctId, uid] of userByAcct) {
    out.set(acctId, { username: nameByUid.get(uid) ?? null, email: emailByUid.get(uid) ?? null });
  }
  return out;
}

export interface BinanceDepositVM {
  id: string;
  customerId: string;
  customerUsername: string | null;
  customerEmail: string | null;
  amount: number;          // requested top-up
  payable: number | null;  // exact amount the customer was told to send (base + unique tail)
  bonus: number;
  currency: string;
  status: string;          // pending | completed | rejected | approved
  orderId: string | null;   // app-visible Binance C2C Order ID
  txId: string | null;     // matched Binance transaction id
  createdAt: string;
}

export interface BinanceTxVM {
  transactionId: string;
  orderId: string | null;
  orderType: string;
  amount: number;
  currency: string;
  receiverId: string | null;
  payerName: string | null;
  transactionTime: string;
  used: boolean;           // already credited to a deposit
}

export interface BinanceReview {
  deposits: BinanceDepositVM[];
  transactions: BinanceTxVM[];
  /** Last time the Pay history was synced (ISO) — null if never. */
  lastSyncAt: string | null;
  /** true when there are open deposits but the sync looks stale (> 5 min old). */
  syncStale: boolean;
}

export async function getBinanceReview(panelId: string): Promise<BinanceReview | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user || !(await ownsPanel(admin, user.id, panelId))) return null;

  const { data: payRows } = await admin
    .from("payments")
    .select("id, customer_id, amount, bonus_amount, binance_payable, binance_order_id, binance_tx_id, currency, status, created_at")
    .eq("panel_id", panelId)
    .eq("gateway", "binance_pay")
    .order("created_at", { ascending: false })
    .limit(100);
  const pays = (payRows as Array<Record<string, unknown>> | null) ?? [];

  const who = await resolveCustomers(admin, panelId, [...new Set(pays.map((p) => p.customer_id as string))]);
  const deposits: BinanceDepositVM[] = pays.map((p) => ({
    id: p.id as string,
    customerId: p.customer_id as string,
    customerUsername: who.get(p.customer_id as string)?.username ?? null,
    customerEmail: who.get(p.customer_id as string)?.email ?? null,
    amount: Number(p.amount) || 0,
    payable: p.binance_payable != null ? Number(p.binance_payable) : null,
    bonus: Number(p.bonus_amount ?? 0) || 0,
    currency: (p.currency as string) ?? "USD",
    status: p.status as string,
    orderId: (p.binance_order_id as string | null) ?? null,
    txId: (p.binance_tx_id as string | null) ?? null,
    createdAt: p.created_at as string,
  }));

  const { data: txRows } = await admin
    .from("binance_pay_transactions")
    .select("transaction_id, order_id, order_type, amount, currency, receiver_binance_id, payer_name, transaction_time, updated_at")
    .eq("panel_id", panelId)
    .order("transaction_time", { ascending: false })
    .limit(50);
  const txs = (txRows as Array<Record<string, unknown>> | null) ?? [];
  const usedTxIds = new Set(deposits.map((d) => d.txId).filter(Boolean) as string[]);
  const transactions: BinanceTxVM[] = txs.map((t) => ({
    transactionId: t.transaction_id as string,
    orderId: (t.order_id as string | null) ?? null,
    orderType: (t.order_type as string) ?? "",
    amount: Number(t.amount) || 0,
    currency: ((t.currency as string) ?? "").toUpperCase(),
    receiverId: (t.receiver_binance_id as string | null) ?? null,
    payerName: (t.payer_name as string | null) ?? null,
    transactionTime: t.transaction_time as string,
    used: usedTxIds.has(t.transaction_id as string),
  }));

  const lastSyncAt = txs.length
    ? (txs.map((t) => t.updated_at as string).sort().at(-1) ?? null)
    : null;
  const hasOpen = deposits.some((d) => d.status === "pending");
  const syncStale = hasOpen && (!lastSyncAt || Date.now() - new Date(lastSyncAt).getTime() > 5 * 60_000);

  return { deposits, transactions, lastSyncAt, syncStale };
}
