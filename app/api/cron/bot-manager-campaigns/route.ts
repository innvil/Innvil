import { NextResponse } from "next/server";
import { sweepBotManagerCampaigns } from "@/src/lib/moderator/bot-manager-campaign-runtime";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return true; // local-dev convenience, matches every other cron route
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${expected}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === expected;
}

async function run(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const result = await sweepBotManagerCampaigns();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/bot-manager-campaigns] sweep failed", err);
    try {
      const admin = createAdminClient();
      await admin.from("audit_logs").insert({
        actor_id: null, action: "cron.bot_manager_campaigns_failed",
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: false, error: "sweep failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
