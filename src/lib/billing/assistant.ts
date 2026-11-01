import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { readSupportSub } from "@/src/lib/ai/addon";
import { AI_ADDON_PRICE, AI_ADDON_PERIOD_DAYS, round4 } from "@/src/lib/money";

/* =========================================================
   Customer AI Support add-on recurring billing sweep (called by the cron).
   For every panel with the paid support add-on enabled whose next charge is due:
     - enough Innvil balance → deduct $2.99, advance the next charge date.
     - not enough → pause the add-on (enabled=false, lapsed=true) until funded.
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

export interface BillingSweepResult {
  due: number;
  charged: number;
  lapsed: number;
}

export async function billDueSupportAddons(): Promise<BillingSweepResult> {
  const admin = createAdminClient();
  const now = new Date();

  const { data } = await admin
    .from("panels")
    .select("id, settings")
    .eq("settings->addons->ai_support->>enabled", "true");

  const rows = (data as Array<{ id: string; settings: unknown }> | null) ?? [];
  let due = 0, charged = 0, lapsed = 0;

  for (const row of rows) {
    const settings = toSettings(row.settings);
    const sub = readSupportSub(settings);
    if (!sub.enabled || !sub.nextChargeAt) continue; // comped (no billing date) or off
    if (new Date(sub.nextChargeAt) > now) continue;  // not due yet
    due++;

    const addons = (settings.addons && typeof settings.addons === "object" ? settings.addons : {}) as Record<string, unknown>;
    const balance = toBalance(settings.innvil_balance);

    if (balance >= AI_ADDON_PRICE) {
      const next = new Date(now.getTime() + AI_ADDON_PERIOD_DAYS * 86400000);
      const updated = {
        ...settings,
        innvil_balance: round4(balance - AI_ADDON_PRICE),
        addons: { ...addons, ai_support: { ...sub, lastChargeAt: now.toISOString(), nextChargeAt: next.toISOString(), lapsed: false } },
      };
      const { error } = await admin.from("panels").update({ settings: updated }).eq("id", row.id);
      if (!error) {
        charged++;
        await admin.from("audit_logs").insert({
          panel_id: row.id, actor_id: null, action: "addon.ai_support_charged",
          meta: { amount: AI_ADDON_PRICE, balance_after: round4(balance - AI_ADDON_PRICE), reason: "renewal" },
        });
      }
    } else {
      const updated = {
        ...settings,
        addons: { ...addons, ai_support: { ...sub, enabled: false, nextChargeAt: null, lapsed: true } },
      };
      const { error } = await admin.from("panels").update({ settings: updated }).eq("id", row.id);
      if (!error) {
        lapsed++;
        await admin.from("audit_logs").insert({
          panel_id: row.id, actor_id: null, action: "addon.ai_support_lapsed",
          meta: { needed: AI_ADDON_PRICE, balance },
        });
      }
    }
  }

  return { due, charged, lapsed };
}
