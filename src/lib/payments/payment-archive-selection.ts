export interface PaymentArchiveSelectionScope {
  panelId: string;
  search: string;
  status: string;
  view: "active" | "archived";
}

export function shouldClearSelection(
  prev: PaymentArchiveSelectionScope,
  next: PaymentArchiveSelectionScope
): boolean {
  return (
    prev.panelId !== next.panelId ||
    prev.search !== next.search ||
    prev.status !== next.status ||
    prev.view !== next.view
  );
}

export function isBulkArchiveDisabled(args: {
  selectedCount: number;
  panelId: string;
  view: "active" | "archived";
  busy: string | null;
}): boolean {
  return args.selectedCount <= 0 || !args.panelId || args.view !== "active" || args.busy === "archive-selected";
}

export function isBulkRestoreDisabled(args: {
  selectedCount: number;
  panelId: string;
  view: "active" | "archived";
  busy: string | null;
}): boolean {
  return args.selectedCount <= 0 || !args.panelId || args.view !== "archived" || args.busy === "restore-selected";
}
