import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { BLOG_POSTS } from "@/src/data/blog-posts";
import { generateBlogDraft, slugify, type GeneratedPost } from "@/src/lib/ai/blog-writer";

/* =========================================================
   Blog draft generation (shared by the cron and the super-admin "generate now").
   NOT auth-gated here — callers gate (cron via CRON_SECRET, admin action via
   requireSuperAdmin). Always inserts as status='draft'; nothing is ever published
   automatically.
   ========================================================= */

/** Evergreen fallback topics used when the curated queue is empty, so the daily
    job still produces something. The super admin's own queue always takes priority. */
const FALLBACK_TOPICS: Array<{ topic: string; keywords: string[] }> = [
  { topic: "How to price services on your SMM panel for healthy margins", keywords: ["smm panel pricing", "smm panel markup"] },
  { topic: "How to choose an SMM provider to resell (a checklist)", keywords: ["smm provider", "best smm provider", "smm reseller"] },
  { topic: "How to get your first customers for a new SMM panel", keywords: ["smm panel marketing", "get smm panel customers"] },
  { topic: "Accepting crypto payments on your SMM panel: a practical guide", keywords: ["smm panel crypto payments", "smm panel payment gateway"] },
  { topic: "White-label SMM panel branding: domain, logo and storefront tips", keywords: ["white label smm panel", "smm panel branding"] },
  { topic: "How order fulfilment and status syncing works on an SMM panel", keywords: ["smm panel orders", "smm order status"] },
  { topic: "Common mistakes new SMM panel owners make (and how to avoid them)", keywords: ["smm panel mistakes", "start smm panel"] },
];

export type GenerationOutcome =
  | { ok: true; slug: string; title: string; topic: string }
  | { ok: false; error: string };

async function existingSlugs(): Promise<Set<string>> {
  const slugs = new Set(BLOG_POSTS.map((p) => p.slug));
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("blog_posts").select("slug");
    for (const r of (data as Array<{ slug: string }> | null) ?? []) slugs.add(r.slug);
  } catch {
    /* fall back to static slugs only */
  }
  return slugs;
}

function uniqueSlug(base: string, taken: Set<string>): string {
  const root = slugify(base) || "smm-panel-guide";
  if (!taken.has(root)) return root;
  for (let i = 2; i < 50; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

async function insertDraft(
  post: GeneratedPost,
  meta: { topic: string; source: "ai" | "manual" }
): Promise<GenerationOutcome> {
  const admin = createAdminClient();
  const taken = await existingSlugs();
  const slug = uniqueSlug(post.slug, taken);

  const { error } = await admin.from("blog_posts").insert({
    slug,
    title: post.title,
    description: post.description,
    tag: post.tag,
    keywords: post.keywords,
    intro: post.intro,
    sections: post.sections,
    cta: post.cta,
    related: [],
    read_minutes: post.readMinutes,
    status: "draft",
    source: meta.source,
    topic: meta.topic,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, slug, title: post.title, topic: meta.topic };
}

/** Generate a draft from an explicit topic (manual "generate now"). */
export async function generateForTopic(topic: string, keywords: string[] = []): Promise<GenerationOutcome> {
  const res = await generateBlogDraft(topic, keywords);
  if (!res.ok) return { ok: false, error: res.error };
  return insertDraft(res.post, { topic: topic.trim(), source: "manual" });
}

/** Pick the next queued topic (or a fallback) and generate a draft. Used by the cron. */
export async function runScheduledGeneration(): Promise<GenerationOutcome> {
  const admin = createAdminClient();

  // 1. Curated queue first.
  let topic = "";
  let keywords: string[] = [];
  let topicRowId: string | null = null;
  try {
    const { data } = await admin
      .from("blog_topics")
      .select("id, topic, keywords")
      .eq("status", "pending")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) {
      topicRowId = (data as { id: string }).id;
      topic = (data as { topic: string }).topic;
      keywords = ((data as { keywords: string[] | null }).keywords) ?? [];
    }
  } catch {
    /* ignore — fall through to fallback */
  }

  // 2. Fallback pool if the queue is empty, avoiding topics already turned into posts.
  if (!topic) {
    const taken = await existingSlugs();
    const pick = FALLBACK_TOPICS.find((t) => !taken.has(slugify(t.topic)));
    const chosen = pick ?? FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
    topic = chosen.topic;
    keywords = chosen.keywords;
  }

  const res = await generateBlogDraft(topic, keywords);
  if (!res.ok) return { ok: false, error: res.error };

  const inserted = await insertDraft(res.post, { topic, source: "ai" });
  if (inserted.ok && topicRowId) {
    await admin.from("blog_topics").update({ status: "used", used_at: new Date().toISOString() }).eq("id", topicRowId);
  }
  return inserted;
}
