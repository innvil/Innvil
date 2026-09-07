import { NextResponse } from "next/server";
import { runAutoPostSweep } from "@/src/lib/moderator/autopost-runtime";
import { createAdminClient } from "@/src/lib/supabase/admin";

/* =========================================================
   AI Telegram Auto-Posting cron (Phase 4.N part B). Hit by an external
   scheduler (Supabase pg_cron in production, every 5 minutes per the
   spec's own worked examples). Gate with CRON_SECRET, same pattern as
   every other Innvil cron route.
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

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const res = await runAutoPostSweep();
    return NextResponse.json(res);
  } catch (e) {
    try {
      const admin = createAdminClient();
      await admin.from("audit_logs").insert({
        action: "cron.autopost",
        meta: { ok: false, method: req.method, error: e instanceof Error ? e.message : "autopost sweep failed" },
      });
    } catch {
      // Keep cron response non-blocking if audit logging fails.
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "autopost sweep failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
