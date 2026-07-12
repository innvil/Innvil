"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";

/* Super-admin platform stats. Every export is gated on the super_admin role.
   Role is read via the service-role client (keyed by the validated user id) rather
   than an RLS read, matching the admin-action pattern used across the app. */

async function requireSuperAdmin(): Promise<boolean> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "super_admin";
}

export interface PlatformOverview {
  panels: number;
  livePanels: number;
  owners: number;
  customers: number;
  orders: number;
}

export async function getPlatformOverview(): Promise<PlatformOverview | null> {
  if (!(await requireSuperAdmin())) return null;
  const admin = createAdminClient();
  const [panels, live, owners, customers, orders] = await Promise.all([
    admin.from("panels").select("id", { count: "exact", head: true }),
    admin.from("panels").select("id", { count: "exact", head: true }).eq("status", "live"),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "panel_owner"),
    admin.from("customer_accounts").select("id", { count: "exact", head: true }),
    admin.from("orders").select("id", { count: "exact", head: true }),
  ]);
  return {
    panels: panels.count ?? 0,
    livePanels: live.count ?? 0,
    owners: owners.count ?? 0,
    customers: customers.count ?? 0,
    orders: orders.count ?? 0,
  };
}

/** Whether the signed-in user is a super admin (for client gating/links). */
export async function amSuperAdmin(): Promise<boolean> {
  return requireSuperAdmin();
}
