import { NextResponse } from "next/server";
import { syncAllOpenOrders } from "@/src/lib/orders/sync";
import { createAdminClient } from "@/src/lib/supabase/admin";

/* =========================================================
   Order-status sync cron.
   This endpoint is hit by an external scheduler (Supabase cron in production).
   Gate with CRON_SECRET: callers can send `Authorization: Bearer <CRON_SECRET>`;
   GET also accepts `?secret=` for manual/local triggering. If CRON_SECRET is
   unset (local dev), it's open so you can hit it in a browser to test.
   ========================================================= */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  if (req.method === "GET") {
    const q = new URL(req.url).searchParams.get("secret");
    if (q === secret) return true;
  }

  return false;
}

async function runSync(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const res = await syncAllOpenOrders();
    try {
      const admin = createAdminClient();
      await admin.from("audit_logs").insert({
        action: "cron.order_sync",
        meta: {
          ok: true,
          method: req.method,
          panels: res.panels,
          checked: res.checked,
          updated: res.updated,
        },
      });
    } catch {
      // Keep cron response non-blocking if audit logging fails.
    }
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    try {
      const admin = createAdminClient();
      await admin.from("audit_logs").insert({
        action: "cron.order_sync",
        meta: {
          ok: false,
          method: req.method,
          error: e instanceof Error ? e.message : "sync failed",
        },
      });
    } catch {
      // Keep cron response non-blocking if audit logging fails.
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return runSync(req);
}

export async function POST(req: Request) {
  return runSync(req);
}
