import "server-only";

import { aiComplete, aiConfigured, getInnvilModelConfig } from "@/src/lib/ai/client";
import type { KnowledgeSource } from "./knowledge";

/**
 * innvil_bot_manager's reactive-support intent layer
 * (innvil-bot-manager-spec.md — "2. Reactive support assistant"). Mirrors
 * link-classify.ts's split (pure policy elsewhere, AI-touching classify +
 * generate here) and stays on the hard INNVIL_REQUIRED_MODEL default
 * (Sonnet 5, medium) via getInnvilModelConfig() — whether an official Innvil
 * answer gets sent at all is exactly the kind of consequential decision that
 * invariant exists to protect, not a candidate for the DeepSeek CASUAL_CHAT
 * carve-out used elsewhere in this codebase.
 */

/** Confidence gate (spec: "confidence-gated, threshold >= 0.80") — below
 *  this, the bot stays silent rather than guessing whether a message is
 *  actually an Innvil-product question. */
export const MANAGER_INTENT_CONFIDENCE_THRESHOLD = 0.8;

export type ManagerMessageIntent = "INNVIL_PRODUCT_QUESTION" | "UNRELATED";

export interface ManagerIntentResult {
  intent: ManagerMessageIntent;
  confidence: number; // 0..1
}

const INTENT_SYSTEM_PROMPT = `You classify a single chat message to decide whether it is a genuine question ABOUT THE INNVIL PLATFORM ITSELF (what Innvil is, how to use it, pricing/plans, panels, domains, the AI Virtual Moderator add-on, support, account/billing questions about Innvil), as opposed to anything else (ordinary conversation, questions about an unrelated topic, questions about a specific panel owner's own business/product, spam, etc.).

Respond with EXACTLY two lines, nothing else:
INTENT: <INNVIL_PRODUCT_QUESTION|UNRELATED>
CONFIDENCE: <a number from 0.00 to 1.00>`;

/** Any failure (unconfigured/errored/malformed) degrades to UNRELATED at
 *  confidence 0 — this bot must never guess its way into answering, and
 *  silence is always the safe default. */
export async function classifyManagerMessageIntent(messageText: string): Promise<ManagerIntentResult> {
  const fallback: ManagerIntentResult = { intent: "UNRELATED", confidence: 0 };
  if (!aiConfigured()) return fallback;
  try {
    const { model, effort } = getInnvilModelConfig();
    const raw = await aiComplete({
      system: INTENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: messageText }],
      model,
      effort,
      // 32 was too tight -- live incident: the model's real "INTENT: ...\n
      // CONFIDENCE: ..." answer was getting cut off mid-response before the
      // CONFIDENCE line ever completed, so the regex below never matched and
      // this silently fell back to UNRELATED/0 confidence for every message,
      // including unambiguous ones ("How much does Innvil cost?"). Matches
      // link-classify.ts's own budget for the same two-line CATEGORY/
      // CONFIDENCE response shape.
      maxTokens: 64,
      automation: "BOT_MANAGER_INTENT_CLASSIFY",
    });
    const intentMatch = raw.match(/INTENT:\s*(INNVIL_PRODUCT_QUESTION|UNRELATED)/i);
    const confidenceMatch = raw.match(/CONFIDENCE:\s*([0-9]*\.?[0-9]+)/);
    const intent = intentMatch?.[1]?.toUpperCase() as ManagerMessageIntent | undefined;
    const confidence = confidenceMatch ? Number(confidenceMatch[1]) : NaN;
    if (!intent || Number.isNaN(confidence)) return fallback;
    return { intent, confidence: Math.max(0, Math.min(1, confidence)) };
  } catch {
    return fallback;
  }
}

const FALLBACK_NO_INFO_LINE =
  "I don't have confirmed information about that yet — for account-specific help, use the Contact support option in your Innvil dashboard.";

/** Grounded-only generation: the model is given ONLY the already-retrieved
 *  product-knowledge entries (never the full knowledge base, never invited
 *  to invent product behavior). Returns the honest fallback line whenever
 *  retrieval came up empty OR generation fails — this bot must never
 *  fabricate a confident-sounding answer about Innvil's own product. */
export async function generateManagerSupportReply(question: string, retrieved: KnowledgeSource[]): Promise<string> {
  if (retrieved.length === 0) return FALLBACK_NO_INFO_LINE;
  if (!aiConfigured()) return FALLBACK_NO_INFO_LINE;
  try {
    const { model, effort } = getInnvilModelConfig();
    const knowledgeBlock = retrieved.map((k) => `- ${k.title}: ${k.content}`).join("\n");
    const raw = await aiComplete({
      system: [
        "You are Innvil's own official assistant, answering a question about the Innvil platform itself.",
        "Answer using ONLY the facts below — never invent pricing, features, or behavior not stated here.",
        "If the facts below don't actually answer the question, say you don't have confirmed information about that and suggest Contact support in the Innvil dashboard for account-specific help.",
        "Keep the answer short and friendly (under 60 words), plain text, no markdown.",
        "",
        "Known facts:",
        knowledgeBlock,
      ].join("\n"),
      messages: [{ role: "user", content: question }],
      model,
      effort,
      maxTokens: 220,
      automation: "BOT_MANAGER_SUPPORT_REPLY",
    });
    const text = raw.trim();
    return text ? text.slice(0, 600) : FALLBACK_NO_INFO_LINE;
  } catch {
    return FALLBACK_NO_INFO_LINE;
  }
}
