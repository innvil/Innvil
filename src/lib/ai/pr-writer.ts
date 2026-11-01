import "server-only";

import { aiComplete, aiprimetechProvider } from "@/src/lib/ai/client";

const PR_MODEL = process.env.BLOG_AI_MODEL || process.env.AI_MODEL || "claude-sonnet-5";

export interface PRFactInput {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceUrl: string | null;
}

export interface PRClaimDraft {
  claimText: string;
  factId: string | null;
  sourceUrl: string | null;
  confidence: number | null;
}

export interface PRDraft {
  title: string;
  slug: string;
  summary: string;
  body: Array<{ kind: "p" | "h3" | "ul" | "ol" | "quote"; text?: string; items?: string[] }>;
  claims: PRClaimDraft[];
}

export type PRDraftResult =
  | { ok: true; draft: PRDraft }
  | { ok: false; error: string };

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found in PR draft response.");
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeBody(raw: unknown): PRDraft["body"] {
  if (!Array.isArray(raw)) return [];
  const out: PRDraft["body"] = [];
  for (const block of raw) {
    if (!block || typeof block !== "object") continue;
    const kind = (block as { kind?: unknown }).kind;
    if (kind !== "p" && kind !== "h3" && kind !== "ul" && kind !== "ol" && kind !== "quote") continue;
    if (kind === "ul" || kind === "ol") {
      const items = ((block as { items?: unknown }).items ?? []) as unknown[];
      const clean = items.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, 12);
      if (!clean.length) continue;
      out.push({ kind, items: clean });
      continue;
    }
    const text = typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text.trim() : "";
    if (!text) continue;
    out.push({ kind, text });
  }
  return out;
}

function normalizeClaims(raw: unknown, facts: PRFactInput[]): PRClaimDraft[] {
  const validFactIds = new Set(facts.map((f) => f.id));
  if (!Array.isArray(raw)) return [];
  const out: PRClaimDraft[] = [];
  for (const claim of raw) {
    if (!claim || typeof claim !== "object") continue;
    const claimText = typeof (claim as { claimText?: unknown }).claimText === "string"
      ? (claim as { claimText: string }).claimText.trim()
      : "";
    if (!claimText) continue;

    const factIdRaw = typeof (claim as { factId?: unknown }).factId === "string"
      ? (claim as { factId: string }).factId.trim()
      : "";
    const factId = factIdRaw && validFactIds.has(factIdRaw) ? factIdRaw : null;

    const sourceUrl = typeof (claim as { sourceUrl?: unknown }).sourceUrl === "string"
      ? (claim as { sourceUrl: string }).sourceUrl.trim() || null
      : null;

    const confidenceRaw = Number((claim as { confidence?: unknown }).confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, Math.round(confidenceRaw * 100) / 100)) : null;

    out.push({ claimText, factId, sourceUrl, confidence });
  }
  return out.slice(0, 30);
}

function validateDraft(raw: unknown, facts: PRFactInput[]): PRDraftResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Model did not return an object." };
  const obj = raw as {
    title?: unknown;
    slug?: unknown;
    summary?: unknown;
    body?: unknown;
    claims?: unknown;
  };

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!title) return { ok: false, error: "Draft is missing title." };
  if (!summary) return { ok: false, error: "Draft is missing summary." };

  const slug = slugify(typeof obj.slug === "string" && obj.slug.trim() ? obj.slug : title);
  if (!slug) return { ok: false, error: "Draft slug could not be derived." };

  const body = normalizeBody(obj.body);
  if (body.length < 3) return { ok: false, error: "Draft body is too short after validation." };

  const claims = normalizeClaims(obj.claims, facts);

  return {
    ok: true,
    draft: {
      title,
      slug,
      summary,
      body,
      claims,
    },
  };
}

export async function generatePRDraft(input: {
  topic: string;
  facts: PRFactInput[];
}): Promise<PRDraftResult> {
  const topic = input.topic.trim();
  if (!topic) return { ok: false, error: "Topic is required for PR generation." };
  if (!input.facts.length) return { ok: false, error: "No active PR facts available. Add facts first." };

  const factLines = input.facts
    .map((f) => `- [${f.id}] ${f.title} (${f.category})\n  ${f.content}${f.sourceUrl ? `\n  Source: ${f.sourceUrl}` : ""}`)
    .join("\n");

  const system = [
    "You are writing a press release draft for Innvil.",
    "Use ONLY facts provided in FACT LIBRARY. Do not invent metrics, partnerships, awards, quotes, audits, listings, timelines, or performance claims.",
    "If a claim is unsupported by provided facts, omit it.",
    "Style: factual, neutral-professional PR tone, concise paragraphs, no hype language.",
    "Return STRICT JSON only.",
  ].join(" ");

  const prompt = [
    `Topic: ${topic}`,
    "",
    "FACT LIBRARY (authoritative):",
    factLines,
    "",
    "Return exactly one JSON object with this shape:",
    "{",
    '  "title": "...",',
    '  "slug": "kebab-case",',
    '  "summary": "1-2 sentence PR summary",',
    '  "body": [',
    '    {"kind":"p","text":"..."},',
    '    {"kind":"h3","text":"..."},',
    '    {"kind":"ul","items":["...","..."]}',
    "  ],",
    '  "claims": [',
    '    {"claimText":"...", "factId":"exact id from facts list", "sourceUrl":"optional", "confidence":0-100}',
    "  ]",
    "}",
    "",
    "Rules:",
    "- Include at least 5 body blocks.",
    "- claims[] should include every non-trivial factual claim made in the draft.",
    "- factId must match one of the provided IDs when possible; use null only if no direct ID applies.",
    "- Never include markdown fences or extra keys.",
  ].join("\n");

  const providerOverride = aiprimetechProvider();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await aiComplete({
        model: PR_MODEL,
        effort: "medium",
        maxTokens: 2200,
        requestTimeoutMs: 300_000,
        automation: "PR_DRAFT_WRITER",
        ...(providerOverride ? { providerOverride } : {}),
        system,
        messages: [{ role: "user", content: prompt }],
      });

      const parsed = extractJson(text);
      const validated = validateDraft(parsed, input.facts);
      if (validated.ok) return validated;
      if (attempt === 1) return validated;
    } catch (e) {
      if (attempt === 1) return { ok: false, error: e instanceof Error ? e.message : "PR draft generation failed." };
    }
  }

  return { ok: false, error: "PR draft generation failed." };
}
