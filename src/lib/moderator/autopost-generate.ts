import "server-only";

import { aiComplete, aiConfigured, getInnvilModelConfig } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";

/* =========================================================
   AI Telegram Auto-Posting — content generation (Phase 4.N part B). Task-
   based model routing per spec §12: scheduled content generation uses
   Sonnet 5 at medium effort, same as substantive Q&A (getInnvilModelConfig,
   the hard INNVIL_REQUIRED_MODEL invariant) — this is a paid, substantive
   generation, not the cheap CASUAL_CHAT carve-out.
   ========================================================= */

const INSUFFICIENT_KNOWLEDGE_SENTINEL = "INSUFFICIENT_KNOWLEDGE";
const MAX_POST_CHARS = 1000; // well under Telegram's 4096 hard limit -- a post should read like a message, not a wall of text

export interface GenerateAutoPostInput {
  moderatorName: string;
  persona: ModeratorPersona;
  /** ALREADY-RETRIEVED knowledge (project + community, community first) —
   *  same shape/precedence contract as chatter-generate.ts's
   *  GenerateChatterReplyInput.projectKnowledge. The ONLY source of factual
   *  claims this post may make. */
  knowledge: { title: string; content: string }[];
  /** Recent post titles/excerpts from THIS community (across every
   *  moderator, spec §21) so the model can naturally pick a different angle
   *  instead of relying solely on the caller's own similarity check. */
  recentPostSummaries: string[];
}

export type GenerateAutoPostResult =
  | { ok: true; title: string; text: string }
  | { ok: true; insufficientKnowledge: true }
  | { ok: false; error: string };

function buildSystemPrompt(input: GenerateAutoPostInput): string {
  const knowledgeBlock = input.knowledge.length
    ? `Project/community knowledge (the ONLY source of factual claims you may make — never state a fact beyond what's here):\n${input.knowledge.map((k) => (k.title ? `- ${k.title}: ${k.content}` : `- ${k.content}`)).join("\n")}`
    : null;
  const recentBlock = input.recentPostSummaries.length
    ? `Recent posts already published in this community (from you or another moderator here) — do not repeat the same angle/topic, pick something different:\n${input.recentPostSummaries.map((s) => `- ${s}`).join("\n")}`
    : null;

  return [
    `You are ${input.moderatorName}, an AI community moderator writing ONE scheduled educational/community Telegram post for this project's community, in your own configured voice.`,
    knowledgeBlock,
    recentBlock,
    `Write a genuinely useful, natural Telegram post (educational post, feature highlight, FAQ-style explainer, community tip, or similar) grounded ONLY in the knowledge above. Do not invent partnerships, prices, APYs/yields, listings, roadmap milestones, audit claims, security guarantees, supported chains, dates, launch announcements, integrations, giveaways, promotions, or statistics unless they are explicitly stated in the knowledge above. Never write as if something just happened ("we just partnered with...", "we're excited to announce...", "our new feature is live...") unless the knowledge explicitly supports that as a real, current fact.`,
    `If the knowledge above is too thin to write a genuine, non-generic post right now, respond with EXACTLY: ${INSUFFICIENT_KNOWLEDGE_SENTINEL}`,
    `Otherwise respond in EXACTLY this format (two lines, nothing else):`,
    `TITLE: <a short internal label for this post, under 8 words, never shown verbatim in the post itself>`,
    `POST: <the actual Telegram post text, natural and concise, under ${MAX_POST_CHARS} characters, no markdown, no placeholder text>`,
  ].filter(Boolean).join("\n\n");
}

function parseResponse(raw: string): { title: string; text: string } | null {
  const titleMatch = /TITLE:\s*(.+)/i.exec(raw);
  const postMatch = /POST:\s*([\s\S]+)/i.exec(raw);
  if (!titleMatch || !postMatch) return null;
  const title = titleMatch[1].trim().slice(0, 200);
  const text = postMatch[1].trim().slice(0, MAX_POST_CHARS);
  if (!text) return null;
  return { title, text };
}

export async function generateAutoPostContent(input: GenerateAutoPostInput): Promise<GenerateAutoPostResult> {
  if (!aiConfigured()) return { ok: false, error: "AI not configured" };
  const { model, effort } = getInnvilModelConfig();
  try {
    const raw = (
      await aiComplete({
        system: buildSystemPrompt(input),
        messages: [{ role: "user", content: "Write today's scheduled post now." }],
        model,
        effort,
        maxTokens: 700,
        automation: "AUTO_POST_GENERATE",
      })
    ).trim();

    if (!raw || raw.toUpperCase().includes(INSUFFICIENT_KNOWLEDGE_SENTINEL)) {
      return { ok: true, insufficientKnowledge: true };
    }
    const parsed = parseResponse(raw);
    if (!parsed) return { ok: false, error: "Model response did not match the expected format." };
    return { ok: true, title: parsed.title, text: parsed.text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI generation failed" };
  }
}
