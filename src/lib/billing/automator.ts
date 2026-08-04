import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { AUTOMATOR_PERIOD_DAYS } from "@/src/lib/money";
import { effectiveAutomatorPrice } from "@/src/lib/automation/pricing";

/* Monthly renewal sweep for customer Automator subscriptions (owner-priced, default
   $6.99 / $9.99 on Business+). Charges due active subs from the customer's wallet at
   the panel's current effective price (owner revenue); pauses (lapsed) any that the
   customer can't cover. Swept by the bill-addons cron. */

export interface AutomatorBillingResult {
  due: number;
  charged: number;
  lapsed: number;
}

export async function billDueAutomatorSubs(): Promise<AutomatorBillingResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: subs } = await admin
    .from("automator_subscriptions")
    .select("id, customer_id, panel_id")
    .eq("active", true)
    .lte("next_charge_at", nowIso);

  const list = (subs as Array<{ id: string; customer_id: string; panel_id: string }> | null) ?? [];

  // Load each involved panel's settings once → the current effective price per panel.
  const panelIds = Array.from(new Set(list.map((s) => s.panel_id)));
  const priceByPanel = new Map<string, number>();
  if (panelIds.length) {
    const { data: panels } = await admin.from("panels").select("id, settings").in("id", panelIds);
    for (const p of (panels as Array<{ id: string; settings: unknown }> | null) ?? []) {
      priceByPanel.set(p.id, effectiveAutomatorPrice(p.settings));
    }
  }

  let charged = 0;
  let lapsed = 0;

  for (const s of list) {
    const price = priceByPanel.get(s.panel_id) ?? 6.99;
    const { error } = await admin.rpc("apply_balance_change", {
      p_customer: s.customer_id,
      p_amount: -price,
      p_type: "order",
      p_reason: "Automator subscription renewal",
    });
    if (error) {
      // Can't cover it → pause until the customer tops up + re-subscribes.
      await admin.from("automator_subscriptions").update({ active: false, lapsed: true, next_charge_at: null }).eq("id", s.id);
      lapsed++;
      continue;
    }
    const next = new Date(Date.now() + AUTOMATOR_PERIOD_DAYS * 86400000).toISOString();
    await admin.from("automator_subscriptions").update({ last_charge_at: new Date().toISOString(), next_charge_at: next, lapsed: false }).eq("id", s.id);
    charged++;
  }

  return { due: list.length, charged, lapsed };
}
