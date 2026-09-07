export interface PaymentArchiveViewRow {
  id: string;
  panelId: string;
  maskedPaymentId: string;
  customerId: string;
  customerUsername: string | null;
  customerEmail: string | null;
  gateway: string | null;
  panelName: string;
  status: string;
  createdAt: string;
}

export type ArchiveStatusFilter = "all" | "pending" | "approved" | "rejected" | "completed";

export interface ArchiveFilterInput {
  panelId: string;
  status: ArchiveStatusFilter;
  search: string;
}

export interface ArchiveRenderStateInput {
  panelId: string;
  loading: boolean;
  loadFailed: boolean;
  panelTotalCount: number;
  filteredCount: number;
}

export type ArchiveRenderState = "no-panel" | "loading" | "load-failed" | "panel-empty" | "filter-empty" | "has-rows";

export function normalizeArchiveSearch(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function maskPanelIdForLog(panelId: string): string {
  const id = String(panelId ?? "");
  if (!id) return "";
  if (id.length <= 12) return `${id.slice(0, 4)}...${id.slice(-3)}`;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export function archiveSearchMatches(row: PaymentArchiveViewRow, search: string): boolean {
  const q = normalizeArchiveSearch(search);
  if (!q) return true;
  const hay = normalizeArchiveSearch(
    [
      row.id,
      row.maskedPaymentId,
      row.customerUsername ?? "",
      row.customerEmail ?? "",
      row.customerId,
      row.gateway ?? "",
      row.panelName,
      row.panelId,
    ].join(" ")
  );
  return hay.includes(q);
}

export function filterPaymentArchiveRows<T extends PaymentArchiveViewRow>(rows: T[], input: ArchiveFilterInput): T[] {
  const pid = String(input.panelId ?? "").trim();
  if (!pid) return [];
  return rows.filter((r) => {
    if (r.panelId !== pid) return false;
    if (input.status !== "all" && String(r.status ?? "").toLowerCase() !== input.status) return false;
    return archiveSearchMatches(r, input.search);
  });
}

export function sortRowsNewestFirst<T extends PaymentArchiveViewRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aTs = Date.parse(a.createdAt);
    const bTs = Date.parse(b.createdAt);
    const aOk = Number.isFinite(aTs);
    const bOk = Number.isFinite(bTs);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return bTs - aTs;
  });
}

export function deriveArchiveRenderState(input: ArchiveRenderStateInput): ArchiveRenderState {
  if (!input.panelId) return "no-panel";
  if (input.loading) return "loading";
  if (input.loadFailed) return "load-failed";
  if (input.panelTotalCount <= 0) return "panel-empty";
  if (input.filteredCount <= 0) return "filter-empty";
  return "has-rows";
}

export function shouldReloadForPanelChange(prevPanelId: string, nextPanelId: string): boolean {
  return prevPanelId !== nextPanelId;
}

export function shouldReloadForViewChange(prevView: "active" | "archived", nextView: "active" | "archived"): boolean {
  return prevView !== nextView;
}

export function shouldReloadAfterBulkMutation(ok: boolean): boolean {
  return ok;
}
