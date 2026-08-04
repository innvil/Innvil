import { NextResponse } from "next/server";
import { sweepWatchedAccounts } from "@/src/lib/automation/watch-sweep";

/*
   Watched-accounts poller (Automator R5b).
   Polls each active watched feed and auto-orders new posts through the customer's
   automation profile. Scheduled via Supabase pg_cron every 5 minutes — see migration
   0036_supabase_watch_accounts_cron.sql (net.http_get to /api/cron/watch-accounts).

   Gate with CRON_SECRET (Authorization: Bearer <CRON_SECRET>; GET also accepts
   ?secret=). Open if CRON_SECRET is unset (local only).
*/

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
    const result = await sweepWatchedAccounts();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
