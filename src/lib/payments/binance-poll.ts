import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { loadActiveBinanceCredentials } from "@/src/lib/payments/binance-credentials";
import { syncPanelBinanceHistory } from "@/src/lib/payments/binance-sync";
import { EXPIRY_MINUTES, type PendingIntent } from "@/src/lib/payments/binance-match";

/* =========================================================
  Cron sweep: for every panel with an open Binance deposit, sync the owner's Pay
  history once so the manual Order ID lookup can see the latest transactions.
   ========================================================= */

export interface BinanceSweepResult {
  panels: number;
  matched: number;
  credited: number;
}

export async function sweepBinanceDeposits(): Promise<BinanceSweepResult> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - (EXPIRY_MINUTES + 5) * 60_000).toISOString();

  const { data: pending } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, amount, binance_payable, created_at")
    .eq("gateway", "binance_pay")
    .eq("status", "pending")
    .not("binance_payable", "is", null)
    .gte("created_at", sinceIso);

  const rows = (pending as Array<PendingIntent & { panel_id: string }> | null) ?? [];
  if (!rows.length) return { panels: 0, matched: 0, credited: 0 };

  // Group open intents by panel.
  const byPanel = new Map<string, PendingIntent[]>();
  for (const r of rows) {
    const list = byPanel.get(r.panel_id) ?? [];
    list.push({
      id: r.id,
      customer_id: r.customer_id,
      amount: String(r.amount),
      binance_payable: r.binance_payable == null ? null : String(r.binance_payable),
      created_at: r.created_at,
    });
    byPanel.set(r.panel_id, list);
  }

  let matched = 0;
  let credited = 0;

  await Promise.all(
    Array.from(byPanel.entries()).map(async ([panelId, intents]) => {
      const creds = await loadActiveBinanceCredentials(panelId);
      if (!creds.ok) return;
      try { await syncPanelBinanceHistory(panelId); } catch { return; }
      void intents;
    })
  );

  return { panels: byPanel.size, matched, credited };
}
