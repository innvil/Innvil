import { NextResponse } from "next/server";
import { billDueSupportAddons } from "@/src/lib/billing/assistant";
import { billDuePlans } from "@/src/lib/billing/plans";
import { billDueAutomatorSubs } from "@/src/lib/billing/automator";
import { runDraftOnboardingSweepCron } from "@/src/lib/actions/platform-support";
import { sweepWatchAutoRenewals } from "@/src/lib/billing/watch-subscriptions";

/* =========================================================
   Add-on recurring billing cron.
   Charges due AI Assistant subscriptions ($2.99/mo) from each panel's Innvil
   balance; pauses the add-on when a panel can't cover it. Also auto-renews
   any direct Innvil Watch subscription whose most recent payment was made
   with Innvil Credit (sweepWatchAutoRenewals) -- a manual-crypto-paid
   subscription is never auto-charged.

   Schedule via Supabase pg_cron (project convention), e.g. daily at 06:00 UTC
   (it only charges subscriptions whose next-charge date has passed):

     select cron.schedule(
       'innvil-bill-addons', '0 6 * * *',
       $$ select net.http_post(
            url    := 'https://innvil.cloud/api/cron/bill-addons',
            headers:= jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
          ); $$
     );

   Gate with CRON_SECRET (Authorization: Bearer <CRON_SECRET>; GET also accepts
   ?secret=). Open if CRON_SECRET is unset (local only).
   ========================================================= */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.method === "GET" && new URL(req.url).searchParams.get("secret") === secret) return true;
  return false;
}

async function run(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const [addons, plans, automator, onboarding, watchRenewals] = await Promise.all([
      billDueSupportAddons(),
      billDuePlans(),
      billDueAutomatorSubs(),
      runDraftOnboardingSweepCron(),
      sweepWatchAutoRenewals(),
    ]);
    return NextResponse.json({ ok: true, addons, plans, automator, onboarding, watchRenewals });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "billing failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
