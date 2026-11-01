import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { readPlan } from "@/src/lib/plans";
import { planPrice, PLAN_PERIOD_DAYS, round4 } from "@/src/lib/money";

/* =========================================================
   Campaign Automation plan recurring billing sweep (called by the bill-addons cron).
   For every panel on a plan whose next charge is due:
     - enough Innvil balance → deduct the tier price, advance the next charge date.
     - not enough → pause the plan (tier=null, lapsed=true) until re-subscribed.
   Not auth-gated (the cron endpoint gates via CRON_SECRET).
   ========================================================= */

type Settings = Record<string, unknown>;
function toSettings(v: unknown): Settings {
  return v && typeof v === "object" ? (v as Settings) : {};
}
function toBalance(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface PlanSweepResult {
  due: number;
  charged: number;
  lapsed: number;
}

export async function billDuePlans(): Promise<PlanSweepResult> {
  const admin = createAdminClient();
  const now = new Date();

  const { data } = await admin
    .from("panels")
    .select("id, settings")
    .not("settings->addons->plan->>tier", "is", null);

  const rows = (data as Array<{ id: string; settings: unknown }> | null) ?? [];
  let due = 0, charged = 0, lapsed = 0;

  for (const row of rows) {
    const settings = toSettings(row.settings);
    const sub = readPlan(settings);
    if (!sub.tier || !sub.nextChargeAt) continue;
    if (new Date(sub.nextChargeAt) > now) continue; // not due yet
    due++;

    const addons = (settings.addons && typeof settings.addons === "object" ? settings.addons : {}) as Record<string, unknown>;
    const price = planPrice(sub.tier);
    const balance = toBalance(settings.innvil_balance);

    if (balance >= price) {
      const next = new Date(now.getTime() + PLAN_PERIOD_DAYS * 86400000);
      const updated = {
        ...settings,
        innvil_balance: round4(balance - price),
        addons: { ...addons, plan: { ...sub, lastChargeAt: now.toISOString(), nextChargeAt: next.toISOString(), lapsed: false } },
      };
      const { error } = await admin.from("panels").update({ settings: updated }).eq("id", row.id);
      if (!error) {
        charged++;
        await admin.from("audit_logs").insert({
          panel_id: row.id, actor_id: null, action: "plan.charged",
          meta: { tier: sub.tier, amount: price, balance_after: round4(balance - price), reason: "renewal" },
        });
      }
    } else {
      // Not enough funds → pause the plan (feature off) until they re-subscribe.
      const updated = {
        ...settings,
        addons: { ...addons, plan: { ...sub, tier: null, nextChargeAt: null, lapsed: true } },
      };
      const { error } = await admin.from("panels").update({ settings: updated }).eq("id", row.id);
      if (!error) {
        lapsed++;
        await admin.from("audit_logs").insert({
          panel_id: row.id, actor_id: null, action: "plan.lapsed",
          meta: { tier: sub.tier, needed: price, balance },
        });
      }
    }
  }

  return { due, charged, lapsed };
}
