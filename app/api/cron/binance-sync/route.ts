import { NextResponse } from "next/server";
import { sweepBinanceDeposits } from "@/src/lib/payments/binance-poll";

/* =========================================================
   Binance Pay deposit poller.
   For every panel with an open Binance deposit, syncs the owner's Pay history and
   refreshes the history used to verify customer-submitted Binance Order IDs.

   Schedule via Supabase pg_cron (project convention), e.g. every minute:

     select cron.schedule(
       'innvil-binance-sync', '* * * * *',
       $$ select net.http_post(
            url    := 'https://innvil.cloud/api/cron/binance-sync',
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
    const result = await sweepBinanceDeposits();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
