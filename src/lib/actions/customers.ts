"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import { round4 } from "@/src/lib/money";
import type { CustomerStatus } from "@/src/types/db";

/* =========================================================
   §6 USERS & BALANCE MANAGEMENT (owner side)
   Real customer_accounts + manual balance credit/debit via the
   apply_balance_change ledger. Owner-authorized via getAuthedAdmin.
   ========================================================= */

type Result<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

async function ownsPanel(admin: SupabaseClient, userId: string, panelId: string): Promise<boolean> {
  const { data } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

export interface PanelCustomerVM {
  id: string; // customer_account id
  userId: string;
  username: string | null;
  email: string | null;
  balance: number;
  status: CustomerStatus;
  orders: number;
  spent: number;
  joinedAt: string;
}

export interface OwnerCustomerVM extends PanelCustomerVM {
  panelId: string;
  panelName: string;
}

export interface CustomerManageDetails {
  customerAccountId: string;
  panelId: string;
  userId: string;
  username: string | null;
  email: string | null;
  status: CustomerStatus;
  balance: number;
}

/** Customers across ALL panels the owner controls (app-level Customers page). */
export async function listAllOwnerCustomers(): Promise<OwnerCustomerVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data: panels } = await admin.from("panels").select("id, name").eq("owner_id", user.id);
  const list = (panels as Array<{ id: string; name: string }> | null) ?? [];
  if (!list.length) return [];
  const nameById = new Map(list.map((p) => [p.id, p.name]));
  const panelIds = list.map((p) => p.id);

  const { data: accts } = await admin
    .from("customer_accounts")
    .select("id, user_id, panel_id, balance, status, created_at")
    .in("panel_id", panelIds)
    .order("created_at", { ascending: false });
  if (!accts?.length) return [];

  const { data: orders } = await admin
    .from("orders")
    .select("customer_id, charge, status")
    .in("panel_id", panelIds);
  const agg = new Map<string, { orders: number; spent: number }>();
  for (const o of orders ?? []) {
    const a = agg.get(o.customer_id as string) ?? { orders: 0, spent: 0 };
    a.orders++;
    if (o.status !== "refunded") a.spent += Number(o.charge);
    agg.set(o.customer_id as string, a);
  }

  const userIds = [...new Set((accts ?? []).map((c) => c.user_id as string).filter(Boolean))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const usernameByUserId = new Map<string, string | null>(
    (profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null])
  );

  const result: OwnerCustomerVM[] = [];
  for (const c of accts) {
    const a = agg.get(c.id as string) ?? { orders: 0, spent: 0 };
    result.push({
      id: c.id as string,
      userId: c.user_id as string,
      username: usernameByUserId.get(c.user_id as string) ?? null,
      email: null,
      balance: Number(c.balance),
      status: c.status as CustomerStatus,
      orders: a.orders,
      spent: round4(a.spent),
      joinedAt: c.created_at as string,
      panelId: c.panel_id as string,
      panelName: nameById.get(c.panel_id as string) ?? "Panel",
    });
  }
  return result;
}

/** All customers on a panel the owner controls, with order count + spend. */
export async function listPanelCustomers(panelId: string): Promise<PanelCustomerVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  if (!(await ownsPanel(admin, user.id, panelId))) return [];

  const { data: accts } = await admin
    .from("customer_accounts")
    .select("id, user_id, balance, status, created_at")
    .eq("panel_id", panelId)
    .order("created_at", { ascending: false });
  if (!accts?.length) return [];

  // Order count + spend (charges on non-refunded orders) per customer.
  const { data: orders } = await admin
    .from("orders")
    .select("customer_id, charge, status")
    .eq("panel_id", panelId);
  const agg = new Map<string, { orders: number; spent: number }>();
  for (const o of orders ?? []) {
    const a = agg.get(o.customer_id as string) ?? { orders: 0, spent: 0 };
    a.orders++;
    if (o.status !== "refunded") a.spent += Number(o.charge);
    agg.set(o.customer_id as string, a);
  }

  const userIds = [...new Set((accts ?? []).map((c) => c.user_id as string).filter(Boolean))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const usernameByUserId = new Map<string, string | null>(
    (profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null])
  );

  const result: PanelCustomerVM[] = [];
  for (const c of accts) {
    const a = agg.get(c.id as string) ?? { orders: 0, spent: 0 };
    result.push({
      id: c.id as string,
      userId: c.user_id as string,
      username: usernameByUserId.get(c.user_id as string) ?? null,
      email: null,
      balance: Number(c.balance),
      status: c.status as CustomerStatus,
      orders: a.orders,
      spent: round4(a.spent),
      joinedAt: c.created_at as string,
    });
  }
  return result;
}

/**
 * Manually credit (amount > 0) or debit (amount < 0) a customer's wallet.
 * Writes a `manual_adjust` ledger row via apply_balance_change (atomic).
 */
export async function adjustCustomerBalance(
  customerAccountId: string,
  amount: number,
  reason: string
): Promise<Result<{ balance: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, panel_id")
    .eq("id", customerAccountId)
    .maybeSingle();
  if (!acct) return { ok: false, error: "Customer not found" };
  if (!(await ownsPanel(admin, user.id, acct.panel_id as string)))
    return { ok: false, error: "Not authorized for this panel" };

  const amt = round4(Number(amount));
  if (!Number.isFinite(amt) || amt === 0) return { ok: false, error: "Enter a non-zero amount." };

  const { data: tx, error } = await admin.rpc("apply_balance_change", {
    p_customer: customerAccountId,
    p_amount: amt,
    p_type: "manual_adjust",
    p_reason: reason.trim() || (amt > 0 ? "Manual credit" : "Manual debit"),
    p_admin: user.id,
  });
  if (error) {
    const msg = /insufficient/i.test(error.message)
      ? "That would put the balance below zero."
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true, data: { balance: Number((tx as { balance_after: number }).balance_after) } };
}

/** Set a customer's account status (active / banned / restricted). */
export async function setCustomerStatus(
  customerAccountId: string,
  status: CustomerStatus
): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, panel_id")
    .eq("id", customerAccountId)
    .maybeSingle();
  if (!acct) return { ok: false, error: "Customer not found" };
  if (!(await ownsPanel(admin, user.id, acct.panel_id as string)))
    return { ok: false, error: "Not authorized for this panel" };

  const { error } = await admin
    .from("customer_accounts")
    .update({ status })
    .eq("id", customerAccountId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Owner-side manage details for one customer account (username/user id/email). */
export async function getCustomerManageDetails(
  customerAccountId: string
): Promise<Result<CustomerManageDetails>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, panel_id, user_id, status, balance")
    .eq("id", customerAccountId)
    .maybeSingle();
  if (!acct) return { ok: false, error: "Customer not found" };
  if (!(await ownsPanel(admin, user.id, acct.panel_id as string))) {
    return { ok: false, error: "Not authorized for this panel" };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", acct.user_id as string)
    .maybeSingle();

  let email: string | null = null;
  try {
    const { data } = await admin.auth.admin.getUserById(acct.user_id as string);
    email = data.user?.email ?? null;
  } catch {
    // best-effort
  }

  return {
    ok: true,
    data: {
      customerAccountId: acct.id as string,
      panelId: acct.panel_id as string,
      userId: acct.user_id as string,
      username: (profile?.display_name as string | null) ?? null,
      email,
      status: acct.status as CustomerStatus,
      balance: Number(acct.balance),
    },
  };
}
