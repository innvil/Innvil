import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { loadActiveBinanceCredentials } from "@/src/lib/payments/binance-credentials";
import { getPayTransactions, type BinancePayRecord } from "@/src/lib/payments/binance";

/* =========================================================
   Sync a panel's Binance Pay history into binance_pay_transactions.
   Primary path is on-demand (called when a claim can't find the tx). An overlapping
   lookback window means a delayed transaction is still picked up by a later run.
   The endpoint has a heavy account weight, so we don't poll it per page view.
   ========================================================= */

const LOOKBACK_MS = 30 * 60 * 1000; // 30 minutes overlap
const PAGE_LIMIT = 100;
const MAX_PAGES_DEFAULT = 8;

export interface SyncBinanceHistoryOptions {
  startTime?: number;
  endTime?: number;
  maxPages?: number;
  stopWhenTransactionId?: string | null;
}

// De-dupe concurrent syncs of the same panel (e.g. two claims at once).
const inFlight = new Map<string, Promise<{ synced: number }>>();

function normalizeTxId(tx: string | null | undefined): string {
  return String(tx ?? "").normalize("NFKC").trim().replace(/\s+/g, "");
}

export async function collectTransactionsForWindow(
  fetchPage: (opts: { startTime: number; endTime: number; limit: number }) => Promise<BinancePayRecord[]>,
  opts: SyncBinanceHistoryOptions
): Promise<{ rows: Array<Record<string, unknown>>; foundTarget: boolean; pages: number }> {
  const now = Date.now();
  const startTime = Math.max(0, Math.floor(opts.startTime ?? now - LOOKBACK_MS));
  let endTime = Math.max(startTime, Math.floor(opts.endTime ?? now));
  const maxPages = Math.max(1, Math.min(20, Math.floor(opts.maxPages ?? MAX_PAGES_DEFAULT)));
  const target = normalizeTxId(opts.stopWhenTransactionId);
  const seenBoundaries = new Set<string>();

  const rows: Array<Record<string, unknown>> = [];
  let foundTarget = false;
  let pages = 0;

  while (pages < maxPages && endTime >= startTime) {
    pages += 1;
    const records = await fetchPage({ startTime, endTime, limit: PAGE_LIMIT });

    if (!records.length) break;

    const sorted = [...records].sort((a, b) => (Number(b.transactionTime) || 0) - (Number(a.transactionTime) || 0));
    const oldest = Math.min(...sorted.map((t) => Number(t.transactionTime) || Number.MAX_SAFE_INTEGER));
    const newest = Math.max(...sorted.map((t) => Number(t.transactionTime) || 0));
    const boundary = `${newest}:${oldest}:${sorted[0]?.transactionId ?? ""}:${sorted[sorted.length - 1]?.transactionId ?? ""}`;

    if (seenBoundaries.has(boundary)) {
      console.warn("[binance-sync] repeated page boundary detected; stopping defensively.", { pages, startTime, endTime });
      break;
    }
    seenBoundaries.add(boundary);

    for (const t of sorted) {
      rows.push({
        transaction_id: String(t.transactionId),
        order_id: t.orderId != null ? String(t.orderId) : null,
        order_type: String(t.orderType ?? ""),
        transaction_time: new Date(Number(t.transactionTime) || Date.now()).toISOString(),
        amount: String(t.amount ?? "0"),
        currency: String(t.currency ?? "").toUpperCase(),
        receiver_binance_id: t.receiverInfo?.binanceId != null ? String(t.receiverInfo.binanceId) : null,
        payer_name: t.payerInfo?.name != null ? String(t.payerInfo.name) : null,
        raw_payload: t as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      });
      if (target && normalizeTxId(t.transactionId) === target) foundTarget = true;
    }

    if (foundTarget) break;
    if (sorted.length < PAGE_LIMIT) break;
    if (!Number.isFinite(oldest)) break;
    if (oldest <= startTime) break;

    const nextEnd = oldest - 1;
    if (nextEnd >= endTime) {
      console.warn("[binance-sync] non-decreasing cursor; stopping defensively.", { pages, startTime, endTime, nextEnd });
      break;
    }
    endTime = nextEnd;
  }

  return { rows, foundTarget, pages };
}

async function collectTransactions(
  apiKey: string,
  apiSecret: string,
  opts: SyncBinanceHistoryOptions
): Promise<{ rows: Array<Record<string, unknown>>; foundTarget: boolean; pages: number }> {
  return collectTransactionsForWindow(
    (p) => getPayTransactions({ apiKey, apiSecret }, p),
    opts
  );
}

async function doSync(panelId: string, opts: SyncBinanceHistoryOptions = {}): Promise<{ synced: number }> {
  const creds = await loadActiveBinanceCredentials(panelId);
  if (!creds.ok) return { synced: 0 };

  const { rows, pages } = await collectTransactions(creds.secrets.apiKey, creds.secrets.apiSecret, opts);
  if (rows.length === 0) return { synced: 0 };
  console.info("[binance-sync] collected", { panelId, pages, rows: rows.length });

  const admin = createAdminClient();
  const payload = rows
    .filter((t) => t.transaction_id)
    .map((t) => ({ panel_id: panelId, ...t }));

  const { error } = await admin
    .from("binance_pay_transactions")
    .upsert(payload, { onConflict: "panel_id,transaction_id" });
  if (error) throw new Error(error.message);
  return { synced: payload.length };
}

export async function syncPanelBinanceHistory(panelId: string, opts: SyncBinanceHistoryOptions = {}): Promise<{ synced: number }> {
  const key = `${panelId}:${Math.floor(opts.startTime ?? 0)}:${Math.floor(opts.endTime ?? 0)}:${Math.floor(opts.maxPages ?? 0)}:${normalizeTxId(opts.stopWhenTransactionId)}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = doSync(panelId, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
