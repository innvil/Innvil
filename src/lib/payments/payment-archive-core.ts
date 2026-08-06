export type PaymentArchiveStatus = "pending" | "approved" | "rejected" | "completed";

export const ARCHIVABLE_PAYMENT_STATUSES: ReadonlyArray<PaymentArchiveStatus> = ["completed", "rejected"];

export function canArchivePaymentStatus(status: string): status is "completed" | "rejected" {
  return status === "completed" || status === "rejected";
}

export interface PaymentArchiveRecord {
  id: string;
  panelId: string;
  customerId: string;
  status: PaymentArchiveStatus;
  amount: number;
  walletBalanceAfter?: number;
  ledgerCount?: number;
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
  if (!canArchivePaymentStatus(row.status)) {
    return { ok: false, error: "ONLY_COMPLETED_OR_REJECTED_ALLOWED", affectedCount: 0, customerIds: [] };
  }
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
    if (!canArchivePaymentStatus(row.status)) continue;
    row.superadminHiddenAt = ts;
    row.superadminHiddenBy = actorId;
    row.superadminHiddenReason = reason || null;
    affected += 1;
    customerIds.add(row.customerId);
  }

  return { ok: true, affectedCount: affected, customerIds: [...customerIds] };
}
