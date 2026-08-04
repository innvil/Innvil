import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getGatewayContext } from "@/src/lib/payments";
import { syncPanelBinanceHistory } from "@/src/lib/payments/binance-sync";
import { findMatchingTx, creditMatch, EXPIRY_MINUTES, type PendingIntent } from "@/src/lib/payments/binance-match";

/* =========================================================
   Cron sweep: for every panel with an open Binance deposit, sync the owner's Pay
   history once and auto-credit any deposit whose unique payable amount now matches an
   incoming transaction. Hands-free credit without the customer pasting a transaction id.
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
    list.push({ id: r.id, customer_id: r.customer_id, amount: r.amount, binance_payable: r.binance_payable, created_at: r.created_at });
    byPanel.set(r.panel_id, list);
  }

  let matched = 0;
  let credited = 0;

  await Promise.all(
    Array.from(byPanel.entries()).map(async ([panelId, intents]) => {
      const ctx = await getGatewayContext(panelId, "binance_pay");
      if (!ctx?.secrets.apiKey || !ctx.secrets.apiSecret) return;
      try { await syncPanelBinanceHistory(panelId); } catch { return; }
      const expectedUid = (ctx.config.binanceUid ?? "").trim();
      for (const intent of intents) {
        const tx = await findMatchingTx(admin, panelId, intent, expectedUid);
        if (!tx) continue;
        matched++;
        const res = await creditMatch(admin, intent, tx, ctx.config);
        if (res.ok) credited++;
      }
    })
  );

  return { panels: byPanel.size, matched, credited };
}
