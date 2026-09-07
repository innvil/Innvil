import { NextResponse } from "next/server";
import { prepareOwnerAssistant, prepareGlobalAssistant } from "@/src/lib/actions/ai-assistant";
import { aiStream, getInnvilModelConfig, type AiMessage } from "@/src/lib/ai/client";

/* Streaming endpoint for the owner's free AI assistant. Auth + grounding happen in
   prepare*; the reply streams as plain text so the UI renders it token-by-token.
   panelId present → panel-scoped; absent → account-level global assistant. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    let body: { panelId?: string; messages?: AiMessage[] };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }

    const panelId = typeof body.panelId === "string" ? body.panelId : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const prep = panelId ? await prepareOwnerAssistant(panelId, messages) : await prepareGlobalAssistant(messages);
    if (!prep.ok) return NextResponse.json({ error: prep.error }, { status: 400 });

    const { model, effort } = getInnvilModelConfig();
    const stream = await aiStream({ system: prep.system, messages: prep.messages, maxTokens: 1024, model, effort, automation: panelId ? "OWNER_ASSISTANT_STREAM" : "GLOBAL_ASSISTANT_STREAM" });
    return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error." }, { status: 500 });
  }
}
