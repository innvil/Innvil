import { NextResponse } from "next/server";
import { runScheduledGeneration } from "@/src/lib/blog/generate";

/* =========================================================
   AI blog draft cron.
   Generates ONE draft per run from the curated topic queue (or a fallback topic)
   and saves it as status='draft'. Nothing is ever published automatically — a
   super admin reviews and publishes from /superadmin → Blog.

   Scheduled by migration 0026_supabase_blog_cron.sql (Supabase pg_cron — project
   convention, not vercel.json). Apply that migration to turn the daily job on.
   Equivalent manual schedule (daily 09:00 UTC), replacing the URL + secret:

     select cron.schedule(
       'innvil-generate-blog',
       '0 9 * * *',
       $$ select net.http_post(
            url    := 'https://innvil.cloud/api/cron/generate-blog',
            headers:= jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
          ); $$
     );

   Gate with CRON_SECRET (Authorization: Bearer <CRON_SECRET>; GET also accepts
   ?secret= for manual triggering). If CRON_SECRET is unset it's open (local only).
   Requires ANTHROPIC_API_KEY for generation.
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
  try {
    const res = await runScheduledGeneration();
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    return NextResponse.json({ ok: true, slug: res.slug, title: res.title, topic: res.topic });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "generation failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
