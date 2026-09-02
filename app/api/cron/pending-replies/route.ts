import { NextResponse } from "next/server";
import { sweepPendingReplies } from "@/src/lib/moderator/community-runtime";
import { createAdminClient } from "@/src/lib/supabase/admin";

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
    const admin = createAdminClient();
    const res = await sweepPendingReplies(admin);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    try {
      const admin = createAdminClient();
      await admin.from("audit_logs").insert({
        action: "cron.pending-replies",
        meta: { ok: false, method: req.method, error: e instanceof Error ? e.message : "pending-reply sweep failed" },
      });
    } catch {
      // Keep cron response non-blocking if audit logging fails.
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "pending-reply sweep failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
