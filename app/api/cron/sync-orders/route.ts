import { NextResponse } from "next/server";
import { syncAllOpenOrders } from "@/src/lib/orders/sync";

/* =========================================================
   Order-status sync cron.
   Vercel Cron hits this on a schedule (see vercel.json). Gate with CRON_SECRET:
   Vercel sends `Authorization: Bearer <CRON_SECRET>` when that env var is set;
   we also accept `?secret=` for manual/local triggering. If CRON_SECRET is unset
   (local dev), it's open so you can hit it in a browser to test.
   ========================================================= */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const res = await syncAllOpenOrders();
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 }
    );
  }
}
