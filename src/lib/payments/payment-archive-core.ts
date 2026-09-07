export type PaymentArchiveStatus = "pending" | "approved" | "rejected" | "completed";

export const ARCHIVABLE_PAYMENT_STATUSES: ReadonlyArray<PaymentArchiveStatus> = ["pending", "approved", "rejected", "completed"];

export function canArchivePaymentStatus(status: string): status is PaymentArchiveStatus {
  return status === "pending" || status === "approved" || status === "rejected" || status === "completed";
}

export interface PaymentArchiveRecord {
  id: string;
  panelId: string;
  customerId: string;
  status: PaymentArchiveStatus;
  amount: number;
  walletBalanceAfter?: number;
  ledgerCount?: number;
  binanceOrderId?: string | null;
  binanceTxId?: string | null;
  duplicateGuardKey?: string | null;
  reconciliationRef?: string | null;
  auditRef?: string | null;
  superadminHiddenAt: string | null;
  superadminHiddenBy: string | null;
  superadminHiddenReason: string | null;
}

export interface ArchiveResult {
  ok: boolean;
  error?: string;
  affectedCount: number;
  customerIds: string[];
}

export function visiblePaymentHistory<T extends { superadminHiddenAt: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.superadminHiddenAt === null);
}

export function archiveOneRecord(
  rows: PaymentArchiveRecord[],
  paymentId: string,
  actorId: string,
  reason: string,
  isSuperAdmin: boolean
): ArchiveResult {
  if (!isSuperAdmin) return { ok: false, error: "FORBIDDEN", affectedCount: 0, customerIds: [] };
  const row = rows.find((r) => r.id === paymentId);
  if (!row) return { ok: false, error: "NOT_FOUND", affectedCount: 0, customerIds: [] };
  if (row.superadminHiddenAt) return { ok: true, affectedCount: 0, customerIds: [] };

  row.superadminHiddenAt = new Date().toISOString();
  row.superadminHiddenBy = actorId;
  row.superadminHiddenReason = reason || null;
  return { ok: true, affectedCount: 1, customerIds: [row.customerId] };
}

export function restoreOneRecord(
  rows: PaymentArchiveRecord[],
  paymentId: string,
  isSuperAdmin: boolean
): ArchiveResult {
  if (!isSuperAdmin) return { ok: false, error: "FORBIDDEN", affectedCount: 0, customerIds: [] };
  const row = rows.find((r) => r.id === paymentId);
  if (!row) return { ok: false, error: "NOT_FOUND", affectedCount: 0, customerIds: [] };
  if (!row.superadminHiddenAt) return { ok: true, affectedCount: 0, customerIds: [] };

  row.superadminHiddenAt = null;
  row.superadminHiddenBy = null;
  row.superadminHiddenReason = null;
  return { ok: true, affectedCount: 1, customerIds: [row.customerId] };
}

export function archivePanelEligibleRecords(
  rows: PaymentArchiveRecord[],
  panelId: string,
  actorId: string,
  reason: string,
  isSuperAdmin: boolean
): ArchiveResult {
  if (!isSuperAdmin) return { ok: false, error: "FORBIDDEN", affectedCount: 0, customerIds: [] };

  const customerIds = new Set<string>();
  let affected = 0;
  const ts = new Date().toISOString();

  for (const row of rows) {
    if (row.panelId !== panelId) continue;
    if (row.superadminHiddenAt) continue;
    row.superadminHiddenAt = ts;
    row.superadminHiddenBy = actorId;
    row.superadminHiddenReason = reason || null;
    affected += 1;
    customerIds.add(row.customerId);
  }

  return { ok: true, affectedCount: affected, customerIds: [...customerIds] };
}

export interface ArchiveSelectedResult {
  ok: boolean;
  error?: string;
  archivedCount: number;
  skippedCount: number;
  customerIds: string[];
}

export interface RestoreSelectedResult {
  ok: boolean;
  error?: string;
  restoredCount: number;
  skippedCount: number;
  customerIds: string[];
}

export function archiveSelectedRecords(
  rows: PaymentArchiveRecord[],
  panelId: string,
  paymentIds: string[],
  actorId: string,
  reason: string,
  isSuperAdmin: boolean
): ArchiveSelectedResult {
  if (!isSuperAdmin) return { ok: false, error: "FORBIDDEN", archivedCount: 0, skippedCount: 0, customerIds: [] };
  const wanted = [...new Set(paymentIds.map((v) => v.trim()).filter(Boolean))];
  const selectedRows = rows.filter((r) => wanted.includes(r.id));
  const crossPanel = selectedRows.filter((r) => r.panelId !== panelId);
  if (crossPanel.length) {
    return {
      ok: false,
      error: "CROSS_PANEL_SELECTION",
      archivedCount: 0,
      skippedCount: wanted.length,
      customerIds: [],
    };
  }

  const ts = new Date().toISOString();
  let archivedCount = 0;
  const customerIds = new Set<string>();
  for (const row of selectedRows) {
    if (row.superadminHiddenAt) continue;
    row.superadminHiddenAt = ts;
    row.superadminHiddenBy = actorId;
    row.superadminHiddenReason = reason || null;
    archivedCount += 1;
    customerIds.add(row.customerId);
  }
  return {
    ok: true,
    archivedCount,
    skippedCount: wanted.length - archivedCount,
    customerIds: [...customerIds],
  };
}

export function restoreSelectedRecords(
  rows: PaymentArchiveRecord[],
  panelId: string,
  paymentIds: string[],
  isSuperAdmin: boolean
): RestoreSelectedResult {
  if (!isSuperAdmin) return { ok: false, error: "FORBIDDEN", restoredCount: 0, skippedCount: 0, customerIds: [] };
  const wanted = [...new Set(paymentIds.map((v) => v.trim()).filter(Boolean))];
  const selectedRows = rows.filter((r) => wanted.includes(r.id));
  const crossPanel = selectedRows.filter((r) => r.panelId !== panelId);
  if (crossPanel.length) {
    return {
      ok: false,
      error: "CROSS_PANEL_SELECTION",
      restoredCount: 0,
      skippedCount: wanted.length,
      customerIds: [],
    };
  }

  let restoredCount = 0;
  const customerIds = new Set<string>();
  for (const row of selectedRows) {
    if (!row.superadminHiddenAt) continue;
    row.superadminHiddenAt = null;
    row.superadminHiddenBy = null;
    row.superadminHiddenReason = null;
    restoredCount += 1;
    customerIds.add(row.customerId);
  }

  return {
    ok: true,
    restoredCount,
    skippedCount: wanted.length - restoredCount,
    customerIds: [...customerIds],
  };
}
