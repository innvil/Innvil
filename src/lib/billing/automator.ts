import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { CUSTOMER_AUTOMATOR_PRICE, AUTOMATOR_PERIOD_DAYS } from "@/src/lib/money";

/* Monthly renewal sweep for customer Automator subscriptions ($6.99/mo). Charges due
   active subs from the customer's wallet (owner revenue); pauses (lapsed) any that the
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
    .select("id, customer_id")
    .eq("active", true)
    .lte("next_charge_at", nowIso);

  const list = (subs as Array<{ id: string; customer_id: string }> | null) ?? [];
  let charged = 0;
  let lapsed = 0;

  for (const s of list) {
    const { error } = await admin.rpc("apply_balance_change", {
      p_customer: s.customer_id,
      p_amount: -CUSTOMER_AUTOMATOR_PRICE,
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
