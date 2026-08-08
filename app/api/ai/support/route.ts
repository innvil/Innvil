import { NextResponse } from "next/server";
import { prepareCustomerSupport } from "@/src/lib/actions/ai-support";
import { aiStream, type AiMessage } from "@/src/lib/ai/client";
import { createStorefrontClient } from "@/src/lib/supabase/server";

/* Streaming endpoint for the storefront customer AI support chat. Auth + add-on gate
   + grounding happen in prepareCustomerSupport; the reply streams as plain text. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const supabase = await createStorefrontClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { panelId?: string; messages?: AiMessage[] };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }

    const panelId = typeof body.panelId === "string" ? body.panelId : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!panelId) return NextResponse.json({ error: "Missing panel." }, { status: 400 });

    const prep = await prepareCustomerSupport(panelId, messages);
    if (!prep.ok) return NextResponse.json({ error: prep.error }, { status: 400 });

    const stream = await aiStream({ system: prep.system, messages: prep.messages, maxTokens: 500, effort: "low", disableThinking: true });
    return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error." }, { status: 500 });
  }
}
