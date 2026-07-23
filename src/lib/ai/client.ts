import "server-only";

/* =========================================================
   Shared AI client (server-only).
   One integration point for every Innvil AI feature (blog writer, chat support,
   future add-ons) so keys, provider, model, and error handling live in one place.
   Never import from the browser.

   PROVIDER-AGNOSTIC: works with Anthropic direct OR any Anthropic-/OpenAI-compatible
   gateway (OpenRouter, Vercel AI Gateway, an Anthropic-style proxy, …) so you can
   plug in a third-party Claude key without touching feature code.

   Env:
     AI_API_KEY        the key (falls back to ANTHROPIC_API_KEY for back-compat)
     AI_PROVIDER       "anthropic" (default) | "openai"   (request protocol)
     AI_BASE_URL       endpoint origin override:
                          anthropic default → https://api.anthropic.com
                          openai   default → https://openrouter.ai/api/v1
     AI_MODEL          default model id (per-call `model` overrides it)
                          NOTE: id format is provider-specific. Anthropic direct:
                          "claude-sonnet-5". OpenRouter: "anthropic/claude-sonnet-5".
                          Vercel AI Gateway: "anthropic/claude-sonnet-5".
   ========================================================= */

export const DEFAULT_AI_MODEL = process.env.AI_MODEL?.trim() || "claude-sonnet-5";

type AiProvider = "anthropic" | "openai";

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

function apiKey(): string | undefined {
  // Trim + strip accidental surrounding quotes — a stray newline/space/quote pasted
  // into the env var is a common cause of a 401 "invalid key".
  return (process.env.AI_API_KEY ?? process.env.ANTHROPIC_API_KEY)?.trim().replace(/^['"]|['"]$/g, "") || undefined;
}

function providerConfig(): { provider: AiProvider; baseUrl: string } {
  const provider: AiProvider = process.env.AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "anthropic";
  const fallbackBase = provider === "openai" ? "https://openrouter.ai/api/v1" : "https://api.anthropic.com";
  const baseUrl = (process.env.AI_BASE_URL?.trim().replace(/\/+$/, "")) || fallbackBase;
  return { provider, baseUrl };
}

/** Whether generation is wired up (a key is present). */
export function aiConfigured(): boolean {
  return Boolean(apiKey());
}

async function anthropicComplete(baseUrl: string, key: string, model: string, opts: AiCompleteOptions): Promise<string> {
  // Anthropic direct authenticates via x-api-key. Third-party Anthropic-compatible
  // proxies (Claude-Code-style resellers) usually want `Authorization: Bearer`, so
  // when a custom base URL is set we send BOTH — Anthropic ignores the extra one.
  const isCustom = !baseUrl.includes("api.anthropic.com");
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      ...(isCustom ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI provider (anthropic) ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
}

async function openaiComplete(baseUrl: string, key: string, model: string, opts: AiCompleteOptions): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      // Optional attribution headers some gateways (e.g. OpenRouter) use — harmless elsewhere.
      "http-referer": process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud",
      "x-title": "Innvil",
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
      messages: [{ role: "system", content: opts.system }, ...opts.messages.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI provider (openai) ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

/** Single non-streaming completion. Returns the text, or throws. */
export async function aiComplete(opts: AiCompleteOptions): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("No AI API key set (AI_API_KEY or ANTHROPIC_API_KEY).");
  const { provider, baseUrl } = providerConfig();
  const model = opts.model || DEFAULT_AI_MODEL;

  const text = provider === "openai"
    ? await openaiComplete(baseUrl, key, model, opts)
    : await anthropicComplete(baseUrl, key, model, opts);

  if (!text) throw new Error("Empty response from model.");
  return text;
}
