"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { INNVIL_COMMISSION_RATE, INNVIL_MIN_COMMISSION_RATE } from "@/src/lib/money";

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

export interface SuperAdminPanelVM {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  ownerId: string;
  ownerEmail: string | null;
  balance: number;
  commissionRate: number; // effective per-panel rate (default 5%)
  ordersToday: number;    // orders created today (bracket reference)
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function toSettings(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function toBalance(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
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

/** Super-admin panel list with owner email + Innvil balance. */
export async function listPanelsForSuperAdmin(limit = 200): Promise<SuperAdminPanelVM[]> {
  if (!(await requireSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("panels")
    .select("id, name, subdomain, status, owner_id, settings")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data as Array<{
    id: string;
    name: string;
    subdomain: string;
    status: string;
    owner_id: string;
    settings: unknown;
  }> | null) ?? [];

  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const emailEntries = await Promise.all(
    ownerIds.map(async (id) => {
      try {
        const { data: user } = await admin.auth.admin.getUserById(id);
        return [id, user.user?.email ?? null] as const;
      } catch {
        return [id, null] as const;
      }
    })
  );
  const ownerEmailById = new Map<string, string | null>(emailEntries);

  // Orders created today per panel — reference for the volume-discount brackets.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const ordersTodayByPanel = new Map<string, number>();
  const { data: todayOrders } = await admin
    .from("orders")
    .select("panel_id")
    .in("panel_id", rows.map((r) => r.id))
    .gte("created_at", startOfToday.toISOString());
  for (const o of (todayOrders as Array<{ panel_id: string }> | null) ?? [])
    ordersTodayByPanel.set(o.panel_id, (ordersTodayByPanel.get(o.panel_id) ?? 0) + 1);

  return rows.map((r) => {
    const settings = toSettings(r.settings);
    const rawRate = Number(settings.commission_rate);
    return {
      id: r.id,
      name: r.name,
      subdomain: r.subdomain,
      status: r.status,
      ownerId: r.owner_id,
      ownerEmail: ownerEmailById.get(r.owner_id) ?? null,
      balance: toBalance(settings.innvil_balance),
      commissionRate: Number.isFinite(rawRate) && rawRate > 0 ? rawRate : INNVIL_COMMISSION_RATE,
      ordersToday: ordersTodayByPanel.get(r.id) ?? 0,
    };
  });
}

/** Set a panel's commission rate (super admin only). Clamped to 1%–5%. */
export async function setPanelCommissionRate(panelId: string, rate: number): Promise<Result<{ rate: number }>> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Super admin only." };
  if (!Number.isFinite(rate)) return { ok: false, error: "Enter a valid rate." };
  const clamped = Math.min(INNVIL_COMMISSION_RATE, Math.max(INNVIL_MIN_COMMISSION_RATE, rate));

  const admin = createAdminClient();
  const { user } = await getAuthedAdmin();
  const { data: row } = await admin.from("panels").select("settings").eq("id", panelId).maybeSingle();
  if (!row) return { ok: false, error: "Panel not found." };

  const settings = toSettings(row.settings);
  const updated = { ...settings, commission_rate: round4(clamped) };
  const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: user?.id ?? null,
    action: "superadmin.commission_rate_set",
    meta: { rate: round4(clamped) },
  });
  return { ok: true, data: { rate: round4(clamped) } };
}

/** Credit/debit a panel's Innvil balance (stored in panels.settings.innvil_balance). */
export async function adjustPanelBalance(
  panelId: string,
  delta: number,
  reason?: string
): Promise<Result<{ balance: number }>> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Super admin only." };
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "Delta must be non-zero." };

  const admin = createAdminClient();
  const { user } = await getAuthedAdmin();
  const { data: row } = await admin
    .from("panels")
    .select("id, name, status, settings")
    .eq("id", panelId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Panel not found." };

  const settings = toSettings(row.settings);
  const current = toBalance(settings.innvil_balance);
  const next = round4(current + delta);
  if (next < 0) return { ok: false, error: "Balance cannot go below 0." };

  const updated: Record<string, unknown> = { ...settings, innvil_balance: next };
  const patch: Record<string, unknown> = { settings: updated };
  // Keep panel status in lockstep with the Innvil-credit rule the sync engine uses:
  // funding an auto-suspended panel reactivates it; draining it to $0 pauses new orders.
  if (next > 0 && settings.innvil_suspended === true) {
    delete updated.innvil_suspended;
    if (row.status === "inactive") patch.status = "live";
  } else if (next <= 0 && row.status === "live") {
    updated.innvil_suspended = true;
    patch.status = "inactive";
  }
  const { error } = await admin.from("panels").update(patch).eq("id", panelId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: user?.id ?? null,
    action: "superadmin.panel_balance_adjusted",
    meta: { delta: round4(delta), balance: next, reason: reason?.trim() || null },
  });

  // Surface any status flip in the panel's Status History too.
  if (typeof patch.status === "string" && patch.status !== row.status) {
    await admin.from("audit_logs").insert({
      panel_id: panelId,
      actor_id: user?.id ?? null,
      action: "panel.status_changed",
      meta: { from: row.status, to: patch.status, by: "system", reason: next > 0 ? "innvil_topup" : "innvil_out_of_credit" },
    });
  }

  return { ok: true, data: { balance: next } };
}

/** Whether the signed-in user is a super admin (for client gating/links). */
export async function amSuperAdmin(): Promise<boolean> {
  return requireSuperAdmin();
}
