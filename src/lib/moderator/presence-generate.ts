import "server-only";

import { aiCompleteWithMeta, deepseekChatterProvider } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";
import { byoProviderOverride, type AccountAiRouting } from "@/src/lib/products/watch-runtime";

/**
 * Watcher Presence Scheduling (Phase 4.U) — persona-voiced, unprompted
 * arrival/departure text. Mirrors media-warning.ts's/link-classify.ts's
 * exact shape (a small dedicated sibling file, BYO-first, deterministic
 * fallback pool) rather than force-fitting into chatter-generate.ts, whose
 * whole system prompt assumes a real triggering human message.
 *
 * Routed through the SAME cheap DeepSeek tier CASUAL_CHAT already uses (a
 * presence greeting is low-stakes ambient text, not substantive Q&A) --
 * never Sonnet 5's getInnvilModelConfig(). BYO Enterprise: `aiRouting?
 * .required` is checked FIRST, exactly like every other generation call
 * site this session touched -- when true, generation routes through the
 * account's own stored credential, and Innvil's own DEEPSEEK_API_KEY is
 * never reached in that branch. Any failure (BYO or Innvil-routed) falls
 * straight to the deterministic per-kind template pool below, so a
 * transition ALWAYS completes even when generation fails.
 */

export type PresenceTransitionKind = "presence_started" | "presence_resumed" | "presence_ending";

/** Real usage from the model call that actually produced this transition's
 *  text -- present only when a real AI call succeeded (BYO or DeepSeek);
 *  absent when generation fell through to the deterministic fallback pool
 *  (no real call happened, or it failed), matching the same "never
 *  fabricate usage for a call that didn't happen" discipline as
 *  chatter-generate.ts's ChatterGenerationUsage. */
export interface PresenceMessageUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}
export interface PresenceMessageResult {
  text: string;
  usage?: PresenceMessageUsage;
}

const FALLBACK_TEMPLATES: Record<PresenceTransitionKind, string[]> = {
  presence_started: ["Morning! I'm around for a bit.", "Hey all, I'm here now.", "Popping in — around for a while."],
  presence_resumed: ["Back again!", "I'm back around.", "Here again for a bit."],
  presence_ending: ["Stepping away for now — back later!", "Heading out for a bit, catch you later.", "Off for now, be back soon."],
};

function fallbackFor(kind: PresenceTransitionKind): string {
  const pool = FALLBACK_TEMPLATES[kind];
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
}

export async function generatePresenceMessage(
  moderatorName: string,
  persona: ModeratorPersona,
  kind: PresenceTransitionKind,
  aiRouting?: AccountAiRouting
): Promise<PresenceMessageResult> {
  const intent =
    kind === "presence_started"
      ? "You are arriving/becoming active in this Telegram community for the first time in this rotation."
      : kind === "presence_resumed"
        ? "You are becoming active again after a short scheduled absence -- a natural 'I'm back' moment."
        : "You are about to step away for a short scheduled absence -- a natural 'heading out for a bit' moment.";

  const system = [
    `You are ${moderatorName}, a moderator in a Telegram community. ${intent}`,
    `Write ONE short, natural, unprompted message announcing this, in your own voice (persona description: ${persona.description || "no specific persona configured — keep it plain and neutral"}).`,
    `Never mention scheduling, rotation, presence windows, or any internal system mechanics — just a natural, casual social message a real person would send.`,
    `Respond with ONLY the message you'd actually send — no quotation marks, no explanation, under 20 words.`,
  ].join("\n");

  if (aiRouting?.required) {
    const cred = aiRouting.credential;
    if (cred?.model) {
      try {
        const result = await aiCompleteWithMeta({
          system,
          messages: [{ role: "user", content: "Write the message now." }],
          model: cred.model,
          providerOverride: byoProviderOverride(cred),
          maxTokens: 100,
          automation: "WATCHER_PRESENCE_BYO",
        });
        const text = result.text.trim();
        if (text) return { text: text.slice(0, 300), usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs: result.durationMs } };
      } catch {
        // fall through to the deterministic pool below
      }
    }
    return { text: fallbackFor(kind) };
  }

  const deepseek = deepseekChatterProvider();
  if (deepseek) {
    try {
      const result = await aiCompleteWithMeta({
        system,
        messages: [{ role: "user", content: "Write the message now." }],
        model: deepseek.model,
        providerOverride: { provider: deepseek.provider, apiKey: deepseek.apiKey, baseUrl: deepseek.baseUrl },
        disableThinking: true,
        maxTokens: 100,
        automation: "WATCHER_PRESENCE",
      });
      const text = result.text.trim();
      if (text) return { text: text.slice(0, 300), usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs: result.durationMs } };
    } catch {
      // fall through to the deterministic pool below
    }
  }
  return { text: fallbackFor(kind) };
}
