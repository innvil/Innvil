import "server-only";

/* =========================================================
   Shared AI client (server-only).
   One integration point for every Innvil AI feature (blog writer, chat support,
   future add-ons) so keys, provider, model, and error handling live in one place.
   Never import from the browser.

   PROVIDER-AGNOSTIC: works with Anthropic direct OR any Anthropic-/OpenAI-compatible
   gateway (OpenRouter, Vercel AI Gateway, an Anthropic-style proxy, …) so you can
   plug in a third-party Claude key without touching feature code.

   Env (primary):
     AI_API_KEY        the key (falls back to ANTHROPIC_API_KEY for back-compat)
     AI_PROVIDER       "anthropic" (default) | "openai"   (request protocol)
     AI_BASE_URL       endpoint origin override:
                          anthropic default → https://api.anthropic.com
                          openai   default → https://openrouter.ai/api/v1
     AI_MODEL          default model id (per-call `model` overrides it)
                          NOTE: id format is provider-specific. Anthropic direct:
                          "claude-sonnet-5". OpenRouter: "anthropic/claude-sonnet-5".
                          Vercel AI Gateway: "anthropic/claude-sonnet-5".

   Env (fallback, all optional): AI_FALLBACK_API_KEY / AI_FALLBACK_PROVIDER /
   AI_FALLBACK_BASE_URL / AI_FALLBACK_MODEL — same shape as above. When the
   primary call throws (including the per-request timeout below) AND a
   fallback key is set, aiComplete retries once against the fallback
   provider before giving up. No fallback key configured = no fallback
   attempt, exactly today's single-provider behavior.
   ========================================================= */

/**
 * Non-negotiable model invariant: every Innvil-authored AI automation
 * (Natural Chatter, moderator replies, community moderation, bot-to-bot
 * conversations, owner/customer assistant chat, and any future add-on) must
 * run on Sonnet 5 — never a silently-substituted cheaper/older model. This
 * does NOT gate a feature's own explicit, deliberate override (e.g. the
 * blog writer's BLOG_AI_MODEL) — those are intentional config knobs a human
 * set, not a silent fallback. It only guards the DEFAULT resolution path, so
 * a missing/misconfigured AI_MODEL fails loudly instead of quietly
 * downgrading to whatever DEFAULT_AI_MODEL used to fall back to.
 */
export const INNVIL_REQUIRED_MODEL = "claude-sonnet-5" as const;

export const DEFAULT_AI_MODEL = process.env.AI_MODEL?.trim() || INNVIL_REQUIRED_MODEL;

/** Throws if `model` isn't exactly the required Sonnet 5 id — call this
 *  before any Innvil-automation AI request (not blog, which owns its own
 *  override). See getInnvilModelConfig() for the usual call site. */
export function assertInnvilModel(model: string): void {
  if (model !== INNVIL_REQUIRED_MODEL) {
    throw new Error(
      `Innvil AI automation requires ${INNVIL_REQUIRED_MODEL}, but resolved to "${model}". ` +
        `Set AI_MODEL=${INNVIL_REQUIRED_MODEL} — do not substitute another model to reduce cost.`
    );
  }
}

/** Canonical model/effort for Innvil-authored AI automation. Re-reads
 *  AI_MODEL fresh (rather than the frozen DEFAULT_AI_MODEL constant) so a
 *  misconfiguration is caught at call time. Throws (via assertInnvilModel)
 *  rather than silently running on the wrong model. */
export function getInnvilModelConfig(): { model: typeof INNVIL_REQUIRED_MODEL; effort: "medium" } {
  const resolved = process.env.AI_MODEL?.trim() || INNVIL_REQUIRED_MODEL;
  assertInnvilModel(resolved);
  return { model: INNVIL_REQUIRED_MODEL, effort: "medium" };
}

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
  /** Claude 5 models default to adaptive thinking at "high" effort — the
   *  thinking tokens come out of the SAME max_tokens budget as the visible
   *  reply, so a small max_tokens meant for a short chat reply can get
   *  silently consumed by invisible reasoning before any answer text is
   *  emitted. For latency-sensitive, low-complexity replies (chat/support),
   *  pass "low" so the model doesn't reason more than the task warrants. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Skips adaptive thinking entirely — for replies with no real reasoning
   *  need, so the whole max_tokens budget goes to the visible answer. */
  disableThinking?: boolean;
  /** Tag for the usage/cost log line below (e.g. "NATURAL_CHATTER") — purely
   *  observability, no effect on the request itself. */
  automation?: string;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
}

/** Logs actual per-call token usage from Anthropic's own response (source of
 *  truth — never estimated from the visible reply text) so cost is auditable
 *  from Vercel's function logs without a separate telemetry pipeline. */
function logAiUsage(opts: AiCompleteOptions, model: string, usage: AnthropicUsage | undefined): void {
  if (!usage) return;
  const thinkingTokens = usage.output_tokens_details?.thinking_tokens ?? 0;
  console.log("[ai-usage]", JSON.stringify({
    automation: opts.automation ?? null,
    model,
    effort: opts.effort ?? null,
    disableThinking: opts.disableThinking ?? false,
    maxTokens: opts.maxTokens ?? 1024,
    inputTokens: usage.input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    thinkingTokens,
    visibleOutputTokens: Math.max(0, (usage.output_tokens ?? 0) - thinkingTokens),
  }));
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

function fallbackApiKey(): string | undefined {
  return process.env.AI_FALLBACK_API_KEY?.trim().replace(/^['"]|['"]$/g, "") || undefined;
}

function fallbackProviderConfig(): { provider: AiProvider; baseUrl: string; model?: string } {
  const provider: AiProvider = process.env.AI_FALLBACK_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "anthropic";
  const fallbackBase = provider === "openai" ? "https://openrouter.ai/api/v1" : "https://api.anthropic.com";
  const baseUrl = (process.env.AI_FALLBACK_BASE_URL?.trim().replace(/\/+$/, "")) || fallbackBase;
  return { provider, baseUrl, model: process.env.AI_FALLBACK_MODEL?.trim() || undefined };
}

/** Whether generation is wired up (a key is present). */
export function aiConfigured(): boolean {
  return Boolean(apiKey());
}

/**
 * Callers on a hard platform deadline (e.g. the Telegram webhook route's
 * `maxDuration = 30`) need the AI call to fail well before that deadline, not
 * hang until the whole function gets killed — a killed function never runs
 * its own catch/fallback logic, so a hung fetch here silently drops the
 * request with no error logged anywhere but Vercel's own runtime dashboard.
 * Sized so a primary timeout PLUS one fallback attempt (see aiComplete) still
 * fits under a 30s caller deadline, with headroom for DB reads/writes and the
 * outbound Telegram call around it.
 */
const AI_REQUEST_TIMEOUT_MS = 12_000;

/** POST JSON for AI providers. */
async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`AI provider request timed out after ${AI_REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function anthropicComplete(baseUrl: string, key: string, model: string, opts: AiCompleteOptions): Promise<string> {
  // Anthropic direct authenticates via x-api-key. Third-party Anthropic-compatible
  // proxies (Claude-Code-style resellers) usually want `Authorization: Bearer`, so
  // when a custom base URL is set we send BOTH — Anthropic ignores the extra one.
  const isCustom = !baseUrl.includes("api.anthropic.com");
  const res = await postJson(`${baseUrl}/v1/messages`, {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    ...(isCustom ? { authorization: `Bearer ${key}` } : {}),
  }, {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
    // effort lives under output_config, NOT as a top-level field — sending it
    // top-level 400s with "effort: Extra inputs are not permitted".
    ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
    ...(opts.disableThinking ? { thinking: { type: "disabled" } } : {}),
    system: opts.system,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI provider (anthropic) ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }>; usage?: AnthropicUsage };
  logAiUsage(opts, model, data.usage);
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
}

async function openaiComplete(baseUrl: string, key: string, model: string, opts: AiCompleteOptions): Promise<string> {
  const res = await postJson(`${baseUrl}/chat/completions`, {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
    // Optional attribution headers some gateways (e.g. OpenRouter) use — harmless elsewhere.
    "http-referer": process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud",
    "x-title": "Innvil",
  }, {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
    messages: [{ role: "system", content: opts.system }, ...opts.messages.map((m) => ({ role: m.role, content: m.content }))],
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI provider (openai) ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function completeOnce(provider: AiProvider, baseUrl: string, key: string, model: string, opts: AiCompleteOptions): Promise<string> {
  const text = provider === "openai" ? await openaiComplete(baseUrl, key, model, opts) : await anthropicComplete(baseUrl, key, model, opts);
  if (!text) throw new Error("Empty response from model.");
  return text;
}

/** Single non-streaming completion. Tries the primary provider; on failure,
 *  retries once against the fallback provider if one is configured. Returns
 *  the text, or throws the primary's error (fallback failures are logged but
 *  don't replace it, since the primary is almost always the more actionable
 *  signal — a misconfigured key vs. a transient timeout look the same otherwise). */
export async function aiComplete(opts: AiCompleteOptions): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("No AI API key set (AI_API_KEY or ANTHROPIC_API_KEY).");
  const { provider, baseUrl } = providerConfig();
  const model = opts.model || DEFAULT_AI_MODEL;

  try {
    return await completeOnce(provider, baseUrl, key, model, opts);
  } catch (primaryErr) {
    const fbKey = fallbackApiKey();
    if (!fbKey) throw primaryErr;
    const fb = fallbackProviderConfig();
    console.error("[ai] primary provider failed, retrying via fallback:", primaryErr instanceof Error ? primaryErr.message : primaryErr);
    try {
      return await completeOnce(fb.provider, fb.baseUrl, fbKey, fb.model || model, opts);
    } catch (fallbackErr) {
      console.error("[ai] fallback provider also failed:", fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      throw primaryErr;
    }
  }
}

/**
 * Streaming completion → a ReadableStream of plain UTF-8 text deltas. Transforms the
 * provider's SSE (Anthropic `content_block_delta` or OpenAI `choices[].delta.content`)
 * into raw text chunks a route handler can pipe straight to the browser. Lets the UI
 * render the answer as it types instead of waiting for the whole thing.
 */
export async function aiStream(opts: AiCompleteOptions): Promise<ReadableStream<Uint8Array>> {
  const key = apiKey();
  if (!key) throw new Error("No AI API key set (AI_API_KEY or ANTHROPIC_API_KEY).");
  const { provider, baseUrl } = providerConfig();
  const model = opts.model || DEFAULT_AI_MODEL;
  const isOpenai = provider === "openai";
  const isCustom = !baseUrl.includes("api.anthropic.com");

  const url = isOpenai ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/messages`;
  const headers: Record<string, string> = isOpenai
    ? { "content-type": "application/json", authorization: `Bearer ${key}`, "http-referer": process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud", "x-title": "Innvil" }
    : { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...(isCustom ? { authorization: `Bearer ${key}` } : {}) };
  const body = isOpenai
    ? { model, max_tokens: opts.maxTokens ?? 1024, stream: true, ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}), messages: [{ role: "system", content: opts.system }, ...opts.messages.map((m) => ({ role: m.role, content: m.content }))] }
    : {
        model,
        max_tokens: opts.maxTokens ?? 1024,
        stream: true,
        ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
        ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        ...(opts.disableThinking ? { thinking: { type: "disabled" } } : {}),
        system: opts.system,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI provider ${res.status}: ${t.slice(0, 300)}`);
  }

  const encoderOnce = new TextEncoder();

  // Fallback: some proxies ignore `stream:true` and return a normal JSON response.
  // Detect that (non-SSE content-type) and emit the whole answer as one chunk.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("event-stream")) {
    const full = await res.text();
    let text = "";
    try {
      const json = JSON.parse(full) as Record<string, unknown>;
      if (isOpenai) {
        const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
        text = choices?.[0]?.message?.content ?? "";
      } else {
        const content = json.content as Array<{ type: string; text?: string }> | undefined;
        text = (content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      }
    } catch {
      text = full;
    }
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (text.trim()) controller.enqueue(encoderOnce.encode(text.trim()));
        controller.close();
      },
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") { controller.close(); return; }
        try {
          const json = JSON.parse(data) as Record<string, unknown>;
          let text = "";
          if (isOpenai) {
            const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined;
            text = choices?.[0]?.delta?.content ?? "";
          } else if (json.type === "content_block_delta") {
            const delta = json.delta as { text?: string } | undefined;
            text = delta?.text ?? "";
          }
          if (text) controller.enqueue(encoder.encode(text));
        } catch {
          /* ignore keepalives / non-JSON event lines */
        }
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
}
