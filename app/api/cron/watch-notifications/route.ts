import { NextResponse } from "next/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { sweepAttentionNotifications } from "@/src/lib/products/watch-notifications";

/* =========================================================
   Innvil Watch "Needs Attention" digest cron.
   Sends at most one digest email per account per 24h, and only to accounts
   that (a) have alerts enabled and (b) currently have real attention items
   — never a scheduled "all clear" email.

   Schedule via Supabase pg_cron (project convention), e.g. hourly (the
   sweep itself enforces the real 24h-per-account minimum interval, so an
   hourly cron just means a new digest goes out close to whenever an
   account's window opens, not that anyone gets emailed hourly):

     select cron.schedule(
       'innvil-watch-notifications', '0 * * * *',
       $$ select net.http_post(
            url    := 'https://innvil.cloud/api/cron/watch-notifications',
            headers:= jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
          ); $$
     );

   Gate with CRON_SECRET (Authorization: Bearer <CRON_SECRET>; GET also
   accepts ?secret=). Open if CRON_SECRET is unset (local only).
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
    const admin = createAdminClient();
    const result = await sweepAttentionNotifications(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "notification sweep failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
