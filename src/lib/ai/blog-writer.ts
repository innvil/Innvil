import "server-only";
import type { BlogBlock, BlogSection } from "@/src/data/blog-posts";

/* =========================================================
   AI blog writer.
   Server-only. Prompts Claude to write a full SMM-panel guide as strict JSON
   matching our block model, then validates it hard before it can become a draft.
   The model is constrained to VERIFIED product facts so it can't invent features
   or fabricate stats. Never publishes — output is always a draft for human review.

   Env:
     ANTHROPIC_API_KEY  (required for generation)
     BLOG_AI_MODEL      (optional; defaults to a strong Claude model)
   ========================================================= */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.BLOG_AI_MODEL || "claude-sonnet-5";

/** Verified facts the writer may rely on. Keep in sync with the product + landing. */
const PRODUCT_FACTS = `
Innvil is a no-code, white-label SMM (social media marketing) panel builder.
- Owners create unlimited white-label panels, each with its own subdomain, storefront, customer dashboard and wallet. Custom domains with automatic SSL are supported and reversible (disconnect falls back to the subdomain).
- Bring-your-own-provider: owners connect their own SMM provider's API; Innvil imports the catalog, applies the owner's markup, forwards orders and syncs statuses. Innvil never sells SMM services itself. Owners keep 95% of every order.
- Pricing: NO monthly rent and NO setup fee. Innvil charges 5% commission on COMPLETED orders only (0% on canceled/refunded). That rate drops toward 1% as a panel scales (roughly 4% at 1,000 completed orders/day, 3% at 2,500, 2% at 5,000, 1% at 10,000+), and Innvil never takes more than $100 from one panel per day. First owner top-up is $10, then $5 minimum.
- Owners can build and preview a live storefront for free; they only fund a panel when ready to take orders.
- Payments (customer deposits): crypto via Cryptomus and NOWPayments (300+ coins) today, more coming; funds credit the wallet automatically on confirmation.
- Customer privacy boundary: owners CANNOT log into customer accounts or reset customer passwords — only adjust balances.
- Do NOT invent usage statistics, user counts, testimonials, or features not listed here. Innvil is pre/early-launch.
`.trim();

const STYLE_RULES = `
Write like a knowledgeable, honest operator — practical, specific, no hype, no emojis.
Audience: people who want to start or grow an SMM panel / reseller business.
The article must be genuinely useful on its own (helpful content), not a thinly veiled ad.
Mention Innvil naturally where relevant, but lead with real information.
Use inline **bold** (double asterisks) sparingly for key terms.
Target 700-1100 words across 4-7 sections.
`.trim();

/** JSON shape we require back from the model. */
interface RawPost {
  title: string;
  slug: string;
  description: string;
  tag: string;
  keywords: string[];
  readMinutes: number;
  intro: string;
  sections: Array<{ h2: string; blocks: BlogBlock[] }>;
  cta?: { heading: string; text: string } | null;
}

export interface GeneratedPost {
  title: string;
  slug: string;
  description: string;
  tag: string;
  keywords: string[];
  readMinutes: number;
  intro: string;
  sections: BlogSection[];
  cta: { heading: string; text: string } | null;
}

export type GenerateResult =
  | { ok: true; post: GeneratedPost }
  | { ok: false; error: string };

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 70)
    .replace(/^-|-$/g, "");
}

const VALID_KINDS = new Set(["p", "h3", "ul", "ol", "quote"]);

function validateBlock(b: unknown): BlogBlock | null {
  if (!b || typeof b !== "object") return null;
  const kind = (b as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !VALID_KINDS.has(kind)) return null;
  if (kind === "ul" || kind === "ol") {
    const items = (b as { items?: unknown }).items;
    if (!Array.isArray(items)) return null;
    const clean = items.filter((i): i is string => typeof i === "string" && i.trim().length > 0);
    if (clean.length === 0) return null;
    return { kind, items: clean } as BlogBlock;
  }
  const text = (b as { text?: unknown }).text;
  if (typeof text !== "string" || text.trim().length === 0) return null;
  return { kind, text: text.trim() } as BlogBlock;
}

function validate(raw: unknown): GenerateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Model did not return an object." };
  const r = raw as Partial<RawPost>;

  const title = typeof r.title === "string" ? r.title.trim() : "";
  const description = typeof r.description === "string" ? r.description.trim() : "";
  const intro = typeof r.intro === "string" ? r.intro.trim() : "";
  if (!title) return { ok: false, error: "Missing title." };
  if (!description) return { ok: false, error: "Missing description." };
  if (!intro) return { ok: false, error: "Missing intro." };

  if (!Array.isArray(r.sections) || r.sections.length < 3) {
    return { ok: false, error: "Need at least 3 sections." };
  }
  const sections: BlogSection[] = [];
  for (const s of r.sections) {
    if (!s || typeof s !== "object") continue;
    const h2 = typeof (s as { h2?: unknown }).h2 === "string" ? (s as { h2: string }).h2.trim() : "";
    const rawBlocks = (s as { blocks?: unknown }).blocks;
    if (!h2 || !Array.isArray(rawBlocks)) continue;
    const blocks = rawBlocks.map(validateBlock).filter((b): b is BlogBlock => b !== null);
    if (blocks.length === 0) continue;
    sections.push({ h2, blocks });
  }
  if (sections.length < 3) return { ok: false, error: "Too few valid sections after validation." };

  const keywords = Array.isArray(r.keywords)
    ? r.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim()).slice(0, 10)
    : [];

  const readMinutesRaw = Number(r.readMinutes);
  const readMinutes = Number.isFinite(readMinutesRaw) ? Math.min(15, Math.max(3, Math.round(readMinutesRaw))) : 6;

  const slug = slugify(typeof r.slug === "string" && r.slug.trim() ? r.slug : title);
  if (!slug) return { ok: false, error: "Could not derive a slug." };

  const tag = typeof r.tag === "string" && r.tag.trim() ? r.tag.trim().slice(0, 24) : "Guide";

  let cta: { heading: string; text: string } | null = null;
  if (r.cta && typeof r.cta === "object") {
    const h = typeof (r.cta as { heading?: unknown }).heading === "string" ? (r.cta as { heading: string }).heading.trim() : "";
    const t = typeof (r.cta as { text?: unknown }).text === "string" ? (r.cta as { text: string }).text.trim() : "";
    if (h && t) cta = { heading: h, text: t };
  }

  return { ok: true, post: { title, slug, description, tag, keywords, readMinutes, intro, sections, cta } };
}

/** Pull the first top-level JSON object out of a model response (tolerates fences/prose). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found in response.");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function callClaude(topic: string, keywords: string[]): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const kw = keywords.length ? `Primary keywords to target naturally: ${keywords.join(", ")}.` : "";
  const userPrompt = `Write one SMM-panel guide article about: "${topic}". ${kw}

Return ONLY a single JSON object (no prose, no markdown fences) with exactly this shape:
{
  "title": "string (compelling, includes the main keyword)",
  "slug": "kebab-case-url-slug",
  "description": "meta description, 140-160 chars",
  "tag": "short category label, e.g. Getting started / Compare / Pricing",
  "keywords": ["3-6 search phrases"],
  "readMinutes": 6,
  "intro": "one lead paragraph shown under the H1",
  "sections": [
    { "h2": "Section heading", "blocks": [
      { "kind": "p", "text": "paragraph" },
      { "kind": "h3", "text": "optional sub-heading" },
      { "kind": "ul", "items": ["bullet", "bullet"] },
      { "kind": "ol", "items": ["step", "step"] },
      { "kind": "quote", "text": "optional pull quote" }
    ]}
  ],
  "cta": { "heading": "closing call to action", "text": "1-2 sentences ending in a create-your-panel nudge" }
}
Use at least 4 sections. Use ul/ol where it genuinely helps. Do not include any keys beyond those shown.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: `You are Innvil's content writer. ${STYLE_RULES}\n\nVERIFIED PRODUCT FACTS (do not contradict or go beyond these):\n${PRODUCT_FACTS}`,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  if (!text.trim()) throw new Error("Empty response from model.");
  return extractJson(text);
}

/** Generate + validate a draft. Retries once on a validation/parse miss. */
export async function generateBlogDraft(topic: string, keywords: string[] = []): Promise<GenerateResult> {
  const clean = topic.trim();
  if (!clean) return { ok: false, error: "Topic is required." };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callClaude(clean, keywords);
      const result = validate(raw);
      if (result.ok) return result;
      if (attempt === 1) return result; // give up with the validation error
    } catch (e) {
      if (attempt === 1) return { ok: false, error: e instanceof Error ? e.message : "Generation failed." };
    }
  }
  return { ok: false, error: "Generation failed." };
}
