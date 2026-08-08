import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { setIntegrationWebhook } from "@/src/lib/moderator/manager";

/**
 * One-off remediation for the Vercel Deployment Protection webhook outage
 * (see manager.ts integrationWebhookUrl / v1.1.68): every subscriber bot's
 * webhook that was registered BEFORE that fix is still pointed at a URL
 * with no bypass param, so Telegram's POSTs still 401. setIntegrationWebhook
 * itself is unchanged — it's re-run here per integration with today's build
 * (which now appends the bypass param when VERCEL_AUTOMATION_BYPASS_SECRET
 * is set in the environment this script runs with).
 *
 * Usage: npm run moderator:rewebhook -- --url=<https://target-deployment>            (all integrations)
 *        npm run moderator:rewebhook -- --url=<https://target-deployment> --id=<telegram_bot_integrations.id>
 *
 * --url is REQUIRED and always wins over .env.local's NEXT_PUBLIC_APP_URL — that
 * value defaults to production, and a silent fallback to it already misrouted a
 * test bot's webhook onto live production once. Pass the exact deployment (a
 * Preview URL, or your production domain if that's really the intent) explicitly.
 */

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const onlyId = parseArg("id");
  const targetUrl = parseArg("url");
  if (!targetUrl) {
    throw new Error("Missing --url=<https://target-deployment>. This is required — see the usage comment at the top of this script.");
  }
  process.env.NEXT_PUBLIC_APP_URL = targetUrl.replace(/\/$/, "");
  console.log(`Registering webhooks against: ${process.env.NEXT_PUBLIC_APP_URL}`);

  const admin = createAdminClient();

  let query = admin.from("telegram_bot_integrations").select("id, username, telegram_bot_id");
  if (onlyId) query = query.eq("id", onlyId);
  const { data: integrations, error } = await query;
  if (error) throw new Error(`Could not list telegram_bot_integrations: ${error.message}`);
  if (!integrations?.length) {
    console.log(onlyId ? `No integration found with id ${onlyId}.` : "No telegram_bot_integrations rows found.");
    return;
  }

  for (const row of integrations) {
    const { data: token, error: keyError } = await admin.rpc("get_telegram_bot_key", {
      p_row: row.id,
      p_secret: providerKeySecret(),
    });
    if (keyError || !token) {
      console.error(`[skip] ${row.id} (@${row.username ?? "?"}) — no decryptable token: ${keyError?.message ?? "empty"}`);
      continue;
    }
    const res = await setIntegrationWebhook(token, row.id);
    if (res.ok) {
      console.log(`[ok]   ${row.id} (@${row.username ?? "?"}) — webhook re-registered`);
    } else {
      console.error(`[fail] ${row.id} (@${row.username ?? "?"}) — ${res.error}`);
    }
  }
}

main().catch((err) => {
  console.error("REREGISTER_FATAL", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
