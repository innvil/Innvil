"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import { PAYMENT_ARCHIVE_CONFIRM_COPY } from "@/src/lib/payments/payment-archive-copy";

const ARCHIVE_NOTICE = PAYMENT_ARCHIVE_CONFIRM_COPY;

type Result<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

interface BulkPaymentSelectionInput {
  panelId: string;
  paymentIds: string[];
  reason?: string;
}

interface BulkArchiveResult {
  archivedCount: number;
  skippedCount: number;
  note: string;
}

interface BulkRestoreResult {
  restoredCount: number;
  skippedCount: number;
}

async function requireSuperAdminContext(): Promise<{ userId: string; admin: SupabaseClient } | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (data?.role !== "super_admin") return null;
  return { userId: user.id, admin };
}

function maskPaymentId(id: string): string {
  if (!id) return "";
  if (id.length <= 12) return `${id.slice(0, 4)}...${id.slice(-3)}`;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function uniqNonEmptyIds(ids: string[]): string[] {
  return [...new Set(ids.map((v) => String(v).trim()).filter(Boolean))];
}

function logCrossPanelMismatch(panelId: string, paymentIds: string[], actorId: string) {
  const sample = paymentIds.slice(0, 5).map(maskPaymentId);
  console.warn("[superadmin-payment-archive] cross-panel-selection-rejected", {
    panelId,
    actorId,
    rejectedCount: paymentIds.length,
    rejectedSample: sample,
  });
}

export interface ArchivedPaymentRow {
  id: string;
  maskedPaymentId: string;
  panelId: string;
  panelName: string;
  customerId: string;
  customerUsername: string | null;
  customerEmail: string | null;
  gateway: string | null;
  method: string;
  amount: number;
  status: string;
  createdAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
  archivedByEmail: string | null;
  reason: string | null;
}

export interface PaymentHistoryLoadError {
  error: "FORBIDDEN" | "INVALID_PANEL" | "LOAD_FAILED";
  code?: string | null;
}

function clampHistoryLimit(limit: number, fallback = 1000, max = 5000): number {
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), max);
}

async function validatePanel(admin: SupabaseClient, panelId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await admin.from("panels").select("id, name").eq("id", panelId).maybeSingle();
  if (!data?.id) return null;
  return { id: String(data.id), name: String(data.name ?? "Panel") };
}

async function rebuildSnapshotsForCustomers(admin: SupabaseClient, customerIds: string[]) {
  for (const cid of customerIds) {
    await admin.rpc("rebuild_storefront_snapshot", { p_customer: cid });
  }
}

async function loadActorEmails(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const uid of userIds) {
    try {
      const { data } = await admin.auth.admin.getUserById(uid);
      map.set(uid, data.user?.email ?? null);
    } catch {
      map.set(uid, null);
    }
  }
  return map;
}

function toRows(
  rows: Array<Record<string, unknown>>,
  panelNameById: Map<string, string>,
  customerUserByCustomerId: Map<string, string>,
  profileNameById: Map<string, string | null>,
  userEmailById: Map<string, string | null>,
  actorEmailById: Map<string, string | null>
): ArchivedPaymentRow[] {
  return rows.map((p) => {
    const customerId = String(p.customer_id ?? "");
    const customerUserId = customerUserByCustomerId.get(customerId) ?? "";
    const archivedBy = (p.superadmin_hidden_by as string | null) ?? null;
    return {
      id: String(p.id),
      maskedPaymentId: maskPaymentId(String(p.id)),
      panelId: String(p.panel_id),
      panelName: panelNameById.get(String(p.panel_id)) ?? "Panel",
      customerId,
      customerUsername: profileNameById.get(customerUserId) ?? null,
      customerEmail: userEmailById.get(customerUserId) ?? null,
      gateway: (p.gateway as string | null) ?? null,
      method: String(p.method ?? ""),
      amount: Number(p.amount ?? 0) + Number(p.bonus_amount ?? 0),
      status: String(p.status ?? ""),
      createdAt: String(p.created_at ?? ""),
      archivedAt: (p.superadmin_hidden_at as string | null) ?? null,
      archivedBy,
      archivedByEmail: archivedBy ? (actorEmailById.get(archivedBy) ?? null) : null,
      reason: (p.superadmin_hidden_reason as string | null) ?? null,
    };
  });
}

export async function listVisiblePayments(limit = 200): Promise<ArchivedPaymentRow[] | { error: "FORBIDDEN" }> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { error: "FORBIDDEN" };
  const { admin } = ctx;

  const { data } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, gateway, method, amount, bonus_amount, status, created_at, superadmin_hidden_at, superadmin_hidden_by, superadmin_hidden_reason")
    .is("superadmin_hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  if (!rows.length) return [];

  const panelIds = [...new Set(rows.map((r) => String(r.panel_id)))];
  const customerIds = [...new Set(rows.map((r) => String(r.customer_id)))];

  const [{ data: panels }, { data: accts }] = await Promise.all([
    admin.from("panels").select("id, name").in("id", panelIds),
    admin.from("customer_accounts").select("id, user_id").in("id", customerIds),
  ]);

  const panelNameById = new Map(((panels as Array<{ id: string; name: string }> | null) ?? []).map((p) => [p.id, p.name]));
  const customerUserByCustomerId = new Map(((accts as Array<{ id: string; user_id: string }> | null) ?? []).map((a) => [a.id, a.user_id]));
  const userIds = [...new Set(Array.from(customerUserByCustomerId.values()))];
  const { data: profiles } = await admin.from("profiles").select("id, display_name").in("id", userIds);
  const profileNameById = new Map(((profiles as Array<{ id: string; display_name: string | null }> | null) ?? []).map((p) => [p.id, p.display_name]));
  const userEmailById = await loadActorEmails(admin, userIds);
  return toRows(rows, panelNameById, customerUserByCustomerId, profileNameById, userEmailById, new Map());
}

export async function listArchivedPayments(limit = 200): Promise<ArchivedPaymentRow[] | { error: "FORBIDDEN" }> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { error: "FORBIDDEN" };
  const { admin } = ctx;

  const { data } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, gateway, method, amount, bonus_amount, status, created_at, superadmin_hidden_at, superadmin_hidden_by, superadmin_hidden_reason")
    .not("superadmin_hidden_at", "is", null)
    .order("superadmin_hidden_at", { ascending: false })
    .limit(limit);

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  if (!rows.length) return [];

  const panelIds = [...new Set(rows.map((r) => String(r.panel_id)))];
  const customerIds = [...new Set(rows.map((r) => String(r.customer_id)))];
  const actorIds = [...new Set(rows.map((r) => (r.superadmin_hidden_by as string | null)).filter((v): v is string => !!v))];

  const [{ data: panels }, { data: accts }] = await Promise.all([
    admin.from("panels").select("id, name").in("id", panelIds),
    admin.from("customer_accounts").select("id, user_id").in("id", customerIds),
  ]);

  const panelNameById = new Map(((panels as Array<{ id: string; name: string }> | null) ?? []).map((p) => [p.id, p.name]));
  const customerUserByCustomerId = new Map(((accts as Array<{ id: string; user_id: string }> | null) ?? []).map((a) => [a.id, a.user_id]));
  const userIds = [...new Set(Array.from(customerUserByCustomerId.values()))];

  const { data: profiles } = await admin.from("profiles").select("id, display_name").in("id", userIds);
  const profileNameById = new Map(((profiles as Array<{ id: string; display_name: string | null }> | null) ?? []).map((p) => [p.id, p.display_name]));
  const userEmailById = await loadActorEmails(admin, userIds);
  const actorEmailById = await loadActorEmails(admin, actorIds);

  return toRows(rows, panelNameById, customerUserByCustomerId, profileNameById, userEmailById, actorEmailById);
}

export async function listVisiblePaymentsForPanel(
  panelId: string,
  limit = 1000
): Promise<ArchivedPaymentRow[] | PaymentHistoryLoadError> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { error: "FORBIDDEN" };
  const { admin } = ctx;

  const pid = String(panelId ?? "").trim();
  if (!pid) return { error: "INVALID_PANEL" };
  const panel = await validatePanel(admin, pid);
  if (!panel) return { error: "INVALID_PANEL" };

  const { data, error } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, gateway, method, amount, bonus_amount, status, created_at, superadmin_hidden_at, superadmin_hidden_by, superadmin_hidden_reason")
    .eq("panel_id", pid)
    .is("superadmin_hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(clampHistoryLimit(limit));

  if (error) return { error: "LOAD_FAILED", code: error.code ?? null };

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  if (!rows.length) return [];

  const customerIds = [...new Set(rows.map((r) => String(r.customer_id)))];
  const { data: accts, error: acctErr } = await admin
    .from("customer_accounts")
    .select("id, user_id")
    .in("id", customerIds);
  if (acctErr) return { error: "LOAD_FAILED", code: acctErr.code ?? null };

  const customerUserByCustomerId = new Map(((accts as Array<{ id: string; user_id: string }> | null) ?? []).map((a) => [a.id, a.user_id]));
  const userIds = [...new Set(Array.from(customerUserByCustomerId.values()))];

  const { data: profiles, error: profileErr } = await admin.from("profiles").select("id, display_name").in("id", userIds);
  if (profileErr) return { error: "LOAD_FAILED", code: profileErr.code ?? null };

  const profileNameById = new Map(((profiles as Array<{ id: string; display_name: string | null }> | null) ?? []).map((p) => [p.id, p.display_name]));
  const userEmailById = await loadActorEmails(admin, userIds);
  const panelNameById = new Map([[panel.id, panel.name]]);

  return toRows(rows, panelNameById, customerUserByCustomerId, profileNameById, userEmailById, new Map());
}

export async function listArchivedPaymentsForPanel(
  panelId: string,
  limit = 1000
): Promise<ArchivedPaymentRow[] | PaymentHistoryLoadError> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { error: "FORBIDDEN" };
  const { admin } = ctx;

  const pid = String(panelId ?? "").trim();
  if (!pid) return { error: "INVALID_PANEL" };
  const panel = await validatePanel(admin, pid);
  if (!panel) return { error: "INVALID_PANEL" };

  const { data, error } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, gateway, method, amount, bonus_amount, status, created_at, superadmin_hidden_at, superadmin_hidden_by, superadmin_hidden_reason")
    .eq("panel_id", pid)
    .not("superadmin_hidden_at", "is", null)
    .order("superadmin_hidden_at", { ascending: false })
    .limit(clampHistoryLimit(limit));

  if (error) return { error: "LOAD_FAILED", code: error.code ?? null };

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  if (!rows.length) return [];

  const customerIds = [...new Set(rows.map((r) => String(r.customer_id)))];
  const actorIds = [...new Set(rows.map((r) => (r.superadmin_hidden_by as string | null)).filter((v): v is string => !!v))];

  const { data: accts, error: acctErr } = await admin
    .from("customer_accounts")
    .select("id, user_id")
    .in("id", customerIds);
  if (acctErr) return { error: "LOAD_FAILED", code: acctErr.code ?? null };

  const customerUserByCustomerId = new Map(((accts as Array<{ id: string; user_id: string }> | null) ?? []).map((a) => [a.id, a.user_id]));
  const userIds = [...new Set(Array.from(customerUserByCustomerId.values()))];

  const { data: profiles, error: profileErr } = await admin.from("profiles").select("id, display_name").in("id", userIds);
  if (profileErr) return { error: "LOAD_FAILED", code: profileErr.code ?? null };

  const profileNameById = new Map(((profiles as Array<{ id: string; display_name: string | null }> | null) ?? []).map((p) => [p.id, p.display_name]));
  const userEmailById = await loadActorEmails(admin, userIds);
  const actorEmailById = await loadActorEmails(admin, actorIds);
  const panelNameById = new Map([[panel.id, panel.name]]);

  return toRows(rows, panelNameById, customerUserByCustomerId, profileNameById, userEmailById, actorEmailById);
}

export async function archivePayment(paymentId: string, reason: string): Promise<Result<{ affected: number; note: string }>> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const { userId, admin } = ctx;

  const trimmedReason = reason.trim();
  const { data: payment } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, status, superadmin_hidden_at")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.superadmin_hidden_at) return { ok: true, data: { affected: 0, note: ARCHIVE_NOTICE } };

  const { data: updated } = await admin
    .from("payments")
    .update({
      superadmin_hidden_at: new Date().toISOString(),
      superadmin_hidden_by: userId,
      superadmin_hidden_reason: trimmedReason || null,
    })
    .eq("id", paymentId)
    .is("superadmin_hidden_at", null)
    .in("status", ["completed", "rejected"])
    .select("id, panel_id, customer_id");

  const rows = (updated as Array<{ id: string; panel_id: string; customer_id: string }> | null) ?? [];
  if (!rows.length) return { ok: false, error: "Payment is already archived or unavailable." };

  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  await rebuildSnapshotsForCustomers(admin, customerIds);

  await admin.from("audit_logs").insert({
    panel_id: rows[0].panel_id,
    actor_id: userId,
    action: "superadmin.payment_history_archived",
    meta: {
      paymentId,
      affectedCount: rows.length,
      reason: trimmedReason || null,
      note: ARCHIVE_NOTICE,
    },
  });

  return { ok: true, data: { affected: rows.length, note: ARCHIVE_NOTICE } };
}

export async function restoreArchivedPayment(paymentId: string, reason: string): Promise<Result<{ affected: number }>> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const { userId, admin } = ctx;

  const trimmedReason = reason.trim();
  const { data: updated } = await admin
    .from("payments")
    .update({
      superadmin_hidden_at: null,
      superadmin_hidden_by: null,
      superadmin_hidden_reason: null,
    })
    .eq("id", paymentId)
    .not("superadmin_hidden_at", "is", null)
    .select("id, panel_id, customer_id");

  const rows = (updated as Array<{ id: string; panel_id: string; customer_id: string }> | null) ?? [];
  if (!rows.length) return { ok: true, data: { affected: 0 } };

  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  await rebuildSnapshotsForCustomers(admin, customerIds);

  await admin.from("audit_logs").insert({
    panel_id: rows[0].panel_id,
    actor_id: userId,
    action: "superadmin.payment_history_restored",
    meta: {
      paymentId,
      affectedCount: rows.length,
      reason: trimmedReason || null,
      note: ARCHIVE_NOTICE,
    },
  });

  return { ok: true, data: { affected: rows.length } };
}

export async function archiveEligiblePanelPayments(panelId: string, reason: string): Promise<Result<{ affected: number; note: string }>> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const { userId, admin } = ctx;
  const trimmedReason = reason.trim();

  const { data: updated } = await admin
    .from("payments")
    .update({
      superadmin_hidden_at: new Date().toISOString(),
      superadmin_hidden_by: userId,
      superadmin_hidden_reason: trimmedReason || null,
    })
    .eq("panel_id", panelId)
    .is("superadmin_hidden_at", null)
    .select("id, customer_id");

  const rows = (updated as Array<{ id: string; customer_id: string }> | null) ?? [];
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  await rebuildSnapshotsForCustomers(admin, customerIds);

  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: userId,
    action: "superadmin.payment_history_panel_archived",
    meta: {
      panelId,
      affectedCount: rows.length,
      reason: trimmedReason || null,
      note: ARCHIVE_NOTICE,
    },
  });

  return { ok: true, data: { affected: rows.length, note: ARCHIVE_NOTICE } };
}

export async function archiveSelectedPayments(input: BulkPaymentSelectionInput): Promise<Result<BulkArchiveResult>> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const { userId, admin } = ctx;

  const panelId = String(input.panelId ?? "").trim();
  const paymentIds = uniqNonEmptyIds(input.paymentIds ?? []);
  const reason = String(input.reason ?? "").trim();
  if (!panelId) return { ok: false, error: "Select a panel first." };
  if (!paymentIds.length) return { ok: false, error: "Select at least one payment." };

  const { data } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, superadmin_hidden_at")
    .in("id", paymentIds);

  const rows = (data as Array<{ id: string; panel_id: string; customer_id: string; superadmin_hidden_at: string | null }> | null) ?? [];
  const crossPanelIds = rows.filter((r) => r.panel_id !== panelId).map((r) => r.id);
  if (crossPanelIds.length) {
    logCrossPanelMismatch(panelId, crossPanelIds, userId);
    return {
      ok: false,
      error: `Rejected ${crossPanelIds.length} record(s) from another panel. No records were archived.`,
    };
  }

  const eligibleIds = rows.filter((r) => r.panel_id === panelId && !r.superadmin_hidden_at).map((r) => r.id);
  const { data: updated } = await admin
    .from("payments")
    .update({
      superadmin_hidden_at: new Date().toISOString(),
      superadmin_hidden_by: userId,
      superadmin_hidden_reason: reason || null,
    })
    .eq("panel_id", panelId)
    .is("superadmin_hidden_at", null)
    .in("id", eligibleIds)
    .select("id, customer_id");

  const archivedRows = (updated as Array<{ id: string; customer_id: string }> | null) ?? [];
  const customerIds = [...new Set(archivedRows.map((r) => r.customer_id))];
  if (customerIds.length) await rebuildSnapshotsForCustomers(admin, customerIds);

  const archivedCount = archivedRows.length;
  const skippedCount = paymentIds.length - archivedCount;

  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: userId,
    action: "superadmin.payment_history_archived_selected",
    meta: {
      panelId,
      selectedCount: paymentIds.length,
      archivedCount,
      skippedCount,
      reason: reason || null,
      note: ARCHIVE_NOTICE,
    },
  });

  return { ok: true, data: { archivedCount, skippedCount, note: ARCHIVE_NOTICE } };
}

export async function restoreSelectedPayments(input: BulkPaymentSelectionInput): Promise<Result<BulkRestoreResult>> {
  const ctx = await requireSuperAdminContext();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const { userId, admin } = ctx;

  const panelId = String(input.panelId ?? "").trim();
  const paymentIds = uniqNonEmptyIds(input.paymentIds ?? []);
  const reason = String(input.reason ?? "").trim();
  if (!panelId) return { ok: false, error: "Select a panel first." };
  if (!paymentIds.length) return { ok: false, error: "Select at least one payment." };

  const { data } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, superadmin_hidden_at")
    .in("id", paymentIds);

  const rows = (data as Array<{ id: string; panel_id: string; customer_id: string; superadmin_hidden_at: string | null }> | null) ?? [];
  const crossPanelIds = rows.filter((r) => r.panel_id !== panelId).map((r) => r.id);
  if (crossPanelIds.length) {
    logCrossPanelMismatch(panelId, crossPanelIds, userId);
    return {
      ok: false,
      error: `Rejected ${crossPanelIds.length} record(s) from another panel. No records were restored.`,
    };
  }

  const restoreIds = rows.filter((r) => r.panel_id === panelId && !!r.superadmin_hidden_at).map((r) => r.id);
  const { data: updated } = await admin
    .from("payments")
    .update({
      superadmin_hidden_at: null,
      superadmin_hidden_by: null,
      superadmin_hidden_reason: null,
    })
    .eq("panel_id", panelId)
    .not("superadmin_hidden_at", "is", null)
    .in("id", restoreIds)
    .select("id, customer_id");

  const restoredRows = (updated as Array<{ id: string; customer_id: string }> | null) ?? [];
  const customerIds = [...new Set(restoredRows.map((r) => r.customer_id))];
  if (customerIds.length) await rebuildSnapshotsForCustomers(admin, customerIds);

  const restoredCount = restoredRows.length;
  const skippedCount = paymentIds.length - restoredCount;

  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: userId,
    action: "superadmin.payment_history_restored_selected",
    meta: {
      panelId,
      selectedCount: paymentIds.length,
      restoredCount,
      skippedCount,
      reason: reason || null,
    },
  });

  return { ok: true, data: { restoredCount, skippedCount } };
}
