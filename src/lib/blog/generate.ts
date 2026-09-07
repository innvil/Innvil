import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { BLOG_POSTS } from "@/src/data/blog-posts";
import { generateBlogDraft, slugify, type GeneratedPost } from "@/src/lib/ai/blog-writer";
import { sendEmail, simpleEmail } from "@/src/lib/email/resend";

/* =========================================================
   Blog draft generation (shared by the cron and the super-admin "generate now").
   NOT auth-gated here — callers gate (cron via CRON_SECRET, admin action via
   requireSuperAdmin). Always inserts as status='draft'; nothing is ever published
   automatically.
   ========================================================= */

/** Evergreen fallback topics used when the curated queue is empty, so the daily
    job still produces something. The super admin's own queue always takes priority.
    Covers BOTH Innvil products (Forge = SMM panel builder, Watch = standalone
    AI Telegram moderator) so the blog isn't permanently Forge-only. */
const FALLBACK_TOPICS: Array<{ topic: string; keywords: string[] }> = [
  { topic: "How to price services on your SMM panel for healthy margins", keywords: ["smm panel pricing", "smm panel markup"] },
  { topic: "How to choose an SMM provider to resell (a checklist)", keywords: ["smm provider", "best smm provider", "smm reseller"] },
  { topic: "How to get your first customers for a new SMM panel", keywords: ["smm panel marketing", "get smm panel customers"] },
  { topic: "Accepting crypto payments on your SMM panel: a practical guide", keywords: ["smm panel crypto payments", "smm panel payment gateway"] },
  { topic: "White-label SMM panel branding: domain, logo and storefront tips", keywords: ["white label smm panel", "smm panel branding"] },
  { topic: "How order fulfilment and status syncing works on an SMM panel", keywords: ["smm panel orders", "smm order status"] },
  { topic: "Common mistakes new SMM panel owners make (and how to avoid them)", keywords: ["smm panel mistakes", "start smm panel"] },
  { topic: "How to keep a Telegram community free of spam and scam links", keywords: ["telegram spam moderation", "telegram scam links", "telegram community moderation"] },
  { topic: "What an AI Telegram moderator actually does (and doesn't do)", keywords: ["ai telegram moderator", "ai community moderator", "telegram bot moderation"] },
  { topic: "Watcher slots explained: how AI moderator capacity actually works", keywords: ["telegram moderator capacity", "ai moderator pricing"] },
  { topic: "Signs your Telegram community needs a moderator (and when a human isn't enough)", keywords: ["telegram community management", "telegram group moderation"] },
  { topic: "How to set up an AI moderator for a Telegram group in under 10 minutes", keywords: ["telegram ai bot setup", "add ai moderator telegram"] },
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

function topicKey(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

async function existingGeneratedTopicKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("blog_posts")
      .select("topic")
      .not("topic", "is", null);
    for (const r of (data as Array<{ topic: string | null }> | null) ?? []) {
      if (!r.topic) continue;
      keys.add(topicKey(r.topic));
    }
  } catch {
    /* no-op: fallback pool still works even if this read fails */
  }
  return keys;
}

async function latestGeneratedTopicKey(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("blog_posts")
      .select("topic")
      .not("topic", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const topic = (data as { topic?: string | null } | null)?.topic;
    return topic ? topicKey(topic) : null;
  } catch {
    return null;
  }
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

/** Email every super admin that a new AI draft is waiting for review (best-effort). */
async function notifySuperAdminsOfDraft(admin: SupabaseClient, title: string): Promise<void> {
  try {
    const { data: supers } = await admin.from("profiles").select("id").eq("role", "super_admin");
    const ids = ((supers as Array<{ id: string }> | null) ?? []).map((r) => r.id);
    if (!ids.length) return;
    const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
    const emails: string[] = [];
    for (const id of ids) {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data.user?.email) emails.push(data.user.email);
      } catch { /* skip */ }
    }
    await Promise.all(
      emails.map((to) =>
        sendEmail({
          to,
          subject: `New AI blog draft to review — ${title}`,
          html: simpleEmail(
            "New AI blog draft ready to review",
            [`A new draft was written: <strong>${title}</strong>.`, "Review, edit, and publish it from the Blog tab in your super-admin dashboard. Nothing goes live until you publish it."],
            app ? { label: "Review in super admin", url: `${app}/superadmin` } : undefined
          ),
        })
      )
    );
  } catch { /* best-effort — never block generation */ }
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

  // Notify super admins about scheduled (AI) drafts — the daily ones they'd otherwise
  // miss. Manual "generate now" drafts are shown inline in the dashboard already.
  if (meta.source === "ai") await notifySuperAdminsOfDraft(admin, post.title);

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
    const usedKeys = await existingGeneratedTopicKeys();
    let candidates = FALLBACK_TOPICS.filter((t) => !usedKeys.has(topicKey(t.topic)));

    // If all fallback topics were used before, at least avoid repeating the very
    // last generated topic when possible.
    if (candidates.length === 0) {
      const latestKey = await latestGeneratedTopicKey();
      if (latestKey) candidates = FALLBACK_TOPICS.filter((t) => topicKey(t.topic) !== latestKey);
      if (candidates.length === 0) candidates = FALLBACK_TOPICS.slice();
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
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
