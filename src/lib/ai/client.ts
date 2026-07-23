import "server-only";

/* =========================================================
   Shared AI client (server-only).
   One integration point for every Innvil AI feature (blog writer, chat support,
   future add-ons) so keys, model selection, and error handling live in one place.
   Uses the Anthropic Messages API directly (no extra deps) against an Innvil-owned
   API account. Never import from the browser.

   Env:
     ANTHROPIC_API_KEY  (required)
     AI_MODEL           (optional global default; per-call `model` overrides it)
   ========================================================= */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Global default model. Individual features may override per call. */
export const DEFAULT_AI_MODEL = process.env.AI_MODEL || "claude-sonnet-5";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCompleteOptions {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  model?: string;
  temperature?: number;
}

/** Whether generation is wired up (an API key is present). */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Single non-streaming completion. Returns the concatenated text, or throws. */
export async function aiComplete(opts: AiCompleteOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_AI_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("Empty response from model.");
  return text;
}
