import { NextResponse } from "next/server";
import { runScheduledPRGeneration } from "@/src/lib/pr/generate";

/* =========================================================
   PR draft cron (Phase C scaffold).
   Generates at most one AI PR draft when due and not blocked by an unpublished PR.
   No external auto-publishing is performed here.
   ========================================================= */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.method === "GET" && new URL(req.url).searchParams.get("secret") === secret) return true;
  return false;
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const res = await runScheduledPRGeneration();
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  }

  return NextResponse.json(res);
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
