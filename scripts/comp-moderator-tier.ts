import { createAdminClient } from "@/src/lib/supabase/admin";

/**
 * One-off testing helper: comp a panel's Virtual Moderator addon to a paid
 * tier (no charge) so multi-community features (e.g. bot-ack, which needs 2
 * communities) can be live-tested before real billing/UI exists. Mirrors the
 * super-admin "comp a plan" pattern used elsewhere in the app (setPanelPlan
 * for Automator/Design Tools): sets panels.settings.addons.moderator.tier
 * directly, nextChargeAt stays null so no cron ever tries to charge it.
 *
 * A paid tier always supersedes an active trial (moderatorEntitlementSource
 * in src/lib/moderator/plan.ts checks tier before trial), so this is
 * sufficient on its own -- no need to also touch the trial state.
 *
 * Usage: npm run moderator:comp -- --panel=<panel-id> [--tier=standard]
 *        npm run moderator:comp -- --integration=<telegram_bot_integrations.id> [--tier=standard]
 */

const TIERS = ["basic", "standard", "premium", "pro"] as const;
type Tier = (typeof TIERS)[number];

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function resolvePanelId(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const explicit = parseArg("panel");
  if (explicit) return explicit;
  const integrationId = parseArg("integration");
  if (!integrationId) {
    throw new Error("Pass --panel=<panel-id> or --integration=<telegram_bot_integrations.id>.");
  }
  const { data, error } = await admin
    .from("telegram_bot_integrations")
    .select("panel_id")
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw new Error(`Could not resolve panel from integration: ${error.message}`);
  if (!data?.panel_id) throw new Error(`No telegram_bot_integrations row found for id ${integrationId}.`);
  return String(data.panel_id);
}

async function main() {
  const tierArg = (parseArg("tier") ?? "standard") as Tier;
  if (!TIERS.includes(tierArg)) {
    throw new Error(`--tier must be one of: ${TIERS.join(", ")}`);
  }

  const admin = createAdminClient();
  const panelId = await resolvePanelId(admin);

  const { data: panel, error: panelError } = await admin.from("panels").select("settings").eq("id", panelId).maybeSingle();
  if (panelError || !panel) throw new Error(`Could not load panel ${panelId}: ${panelError?.message ?? "not found"}`);

  const settings = (panel.settings as Record<string, unknown>) ?? {};
  const addons = (settings.addons as Record<string, unknown>) ?? {};
  const moderatorAddon = (addons.moderator as Record<string, unknown>) ?? {};

  const nextSettings = {
    ...settings,
    addons: {
      ...addons,
      moderator: {
        ...moderatorAddon,
        tier: tierArg,
        commercialMode: moderatorAddon.commercialMode ?? "commission",
        since: new Date().toISOString(),
        lapsed: false,
      },
    },
  };

  const { error: updateError } = await admin.from("panels").update({ settings: nextSettings }).eq("id", panelId);
  if (updateError) throw new Error(`Could not update panel settings: ${updateError.message}`);

  console.log(`Panel ${panelId} comped to Virtual Moderator tier "${tierArg}" (no charge).`);
}

main().catch((err) => {
  console.error("COMP_MODERATOR_TIER_FATAL", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
