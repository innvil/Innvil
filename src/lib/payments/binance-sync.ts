import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getGatewayContext } from "@/src/lib/payments";
import { getPayTransactions } from "@/src/lib/payments/binance";

/* =========================================================
   Sync a panel's Binance Pay history into binance_pay_transactions.
   Primary path is on-demand (called when a claim can't find the tx). An overlapping
   lookback window means a delayed transaction is still picked up by a later run.
   The endpoint has a heavy account weight, so we don't poll it per page view.
   ========================================================= */

const LOOKBACK_MS = 30 * 60 * 1000; // 30 minutes overlap

// De-dupe concurrent syncs of the same panel (e.g. two claims at once).
const inFlight = new Map<string, Promise<{ synced: number }>>();

async function doSync(panelId: string): Promise<{ synced: number }> {
  const ctx = await getGatewayContext(panelId, "binance_pay");
  if (!ctx) return { synced: 0 };
  const apiKey = ctx.secrets.apiKey;
  const apiSecret = ctx.secrets.apiSecret;
  if (!apiKey || !apiSecret) return { synced: 0 };

  const now = Date.now();
  const records = await getPayTransactions({ apiKey, apiSecret }, { startTime: now - LOOKBACK_MS, endTime: now, limit: 100 });
  if (records.length === 100) {
    console.warn(`[binance-sync] panel ${panelId} returned 100 records — window may be truncated.`);
  }
  if (records.length === 0) return { synced: 0 };

  const admin = createAdminClient();
  const rows = records
    .filter((t) => t.transactionId)
    .map((t) => ({
      panel_id: panelId,
      transaction_id: String(t.transactionId),
      order_type: String(t.orderType ?? ""),
      transaction_time: new Date(Number(t.transactionTime) || Date.now()).toISOString(),
      amount: String(t.amount ?? "0"),
      currency: String(t.currency ?? "").toUpperCase(),
      receiver_binance_id: t.receiverInfo?.binanceId != null ? String(t.receiverInfo.binanceId) : null,
      payer_name: t.payerInfo?.name != null ? String(t.payerInfo.name) : null,
      raw_payload: t as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }));

  const { error } = await admin
    .from("binance_pay_transactions")
    .upsert(rows, { onConflict: "panel_id,transaction_id" });
  if (error) throw new Error(error.message);
  return { synced: rows.length };
}

export async function syncPanelBinanceHistory(panelId: string): Promise<{ synced: number }> {
  const existing = inFlight.get(panelId);
  if (existing) return existing;
  const p = doSync(panelId).finally(() => inFlight.delete(panelId));
  inFlight.set(panelId, p);
  return p;
}
