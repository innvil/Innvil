"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { slugify } from "@/src/lib/ai/blog-writer";
import { generateForTopic, runScheduledGeneration } from "@/src/lib/blog/generate";
import type { BlogSection, BlogPost } from "@/src/data/blog-posts";

/** Refresh the ISR-cached blog surfaces so published/unpublished posts appear
 *  immediately (instead of waiting up to an hour for revalidation). */
function revalidateBlog(slug?: string) {
  try {
    revalidatePath("/blog");
    revalidatePath("/sitemap.xml");
    if (slug) revalidatePath(`/blog/${slug}`);
  } catch {
    /* revalidatePath can throw outside a request scope — safe to ignore */
  }
}

/* Super-admin blog management. Every export is gated on the super_admin role.
   Reads/writes go through the service-role client (auth enforced in code), matching
   the rest of the admin-action layer. */

async function requireSuperAdmin(): Promise<{ ok: boolean; userId?: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false };
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { ok: data?.role === "super_admin", userId: user.id };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AdminBlogPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  tag: string;
  keywords: string[];
  intro: string;
  sections: BlogSection[];
  cta: BlogPost["cta"];
  readMinutes: number;
  status: "draft" | "published" | "archived";
  source: "ai" | "manual";
  topic: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface AdminBlogTopic {
  id: string;
  topic: string;
  keywords: string[];
  status: "pending" | "used" | "skipped";
  priority: number;
  createdAt: string;
}

interface PostRow {
  id: string; slug: string; title: string; description: string; tag: string;
  keywords: string[] | null; intro: string; sections: unknown; cta: unknown;
  read_minutes: number; status: string; source: string; topic: string | null;
  created_at: string; published_at: string | null;
}

function rowToAdmin(r: PostRow): AdminBlogPost {
  const cta = r.cta && typeof r.cta === "object"
    ? { heading: String((r.cta as { heading?: unknown }).heading ?? ""), text: String((r.cta as { text?: unknown }).text ?? "") }
    : undefined;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    tag: r.tag,
    keywords: r.keywords ?? [],
    intro: r.intro,
    sections: Array.isArray(r.sections) ? (r.sections as BlogSection[]) : [],
    cta: cta && cta.heading && cta.text ? cta : undefined,
    readMinutes: r.read_minutes,
    status: (["draft", "published", "archived"].includes(r.status) ? r.status : "draft") as AdminBlogPost["status"],
    source: (r.source === "manual" ? "manual" : "ai"),
    topic: r.topic,
    createdAt: r.created_at,
    publishedAt: r.published_at,
  };
}

export async function listAdminPosts(): Promise<AdminBlogPost[]> {
  if (!(await requireSuperAdmin()).ok) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("blog_posts")
    .select("id, slug, title, description, tag, keywords, intro, sections, cta, read_minutes, status, source, topic, created_at, published_at")
    .order("created_at", { ascending: false });
  return ((data as PostRow[] | null) ?? []).map(rowToAdmin);
}

export interface BlogDraftNotice {
  id: string;
  title: string;
  createdAt: string;
}

/** Lightweight list of pending drafts for the owner-app bell (super admin only). */
export async function listBlogDraftNotices(): Promise<BlogDraftNotice[]> {
  if (!(await requireSuperAdmin()).ok) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("blog_posts")
    .select("id, title, created_at")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(10);
  return ((data as Array<{ id: string; title: string; created_at: string }> | null) ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
  }));
}

export async function listTopics(): Promise<AdminBlogTopic[]> {
  if (!(await requireSuperAdmin()).ok) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("blog_topics")
    .select("id, topic, keywords, status, priority, created_at")
    .order("status", { ascending: true })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  return ((data as Array<{ id: string; topic: string; keywords: string[] | null; status: string; priority: number; created_at: string }> | null) ?? []).map((r) => ({
    id: r.id,
    topic: r.topic,
    keywords: r.keywords ?? [],
    status: (["pending", "used", "skipped"].includes(r.status) ? r.status : "pending") as AdminBlogTopic["status"],
    priority: r.priority,
    createdAt: r.created_at,
  }));
}

export async function addTopic(topic: string, keywords: string[] = [], priority = 0): Promise<Result<{ id: string }>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const clean = topic.trim();
  if (!clean) return { ok: false, error: "Topic is required." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_topics")
    .insert({ topic: clean, keywords: keywords.map((k) => k.trim()).filter(Boolean), priority })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Bulk-add topics (paste or file upload). Skips blanks + duplicates (existing topics
 *  and repeats within the batch), case-insensitive. */
export async function addTopicsBulk(
  items: Array<{ topic: string; keywords: string[] }>,
): Promise<Result<{ added: number; skipped: number }>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();

  // Existing topic set (case-insensitive) to skip duplicates.
  const { data: existing } = await admin.from("blog_topics").select("topic");
  const seen = new Set(
    ((existing as Array<{ topic: string }> | null) ?? []).map((r) => r.topic.trim().toLowerCase()),
  );

  const rows: Array<{ topic: string; keywords: string[]; priority: number }> = [];
  let skipped = 0;
  for (const it of items) {
    const clean = (it.topic ?? "").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    rows.push({ topic: clean, keywords: (it.keywords ?? []).map((k) => k.trim()).filter(Boolean), priority: 0 });
  }

  if (rows.length === 0) return { ok: true, data: { added: 0, skipped } };
  const { error } = await admin.from("blog_topics").insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { added: rows.length, skipped } };
}

export async function deleteTopic(id: string): Promise<Result<null>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { error } = await admin.from("blog_topics").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Generate a draft now. With a topic → uses it; without → next queued/fallback topic. */
export async function generateDraftNow(topic?: string, keywords: string[] = []): Promise<Result<{ slug: string; title: string }>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const res = topic && topic.trim() ? await generateForTopic(topic, keywords) : await runScheduledGeneration();
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: { slug: res.slug, title: res.title } };
}

export async function publishPost(id: string): Promise<Result<null>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidateBlog((data as { slug: string } | null)?.slug);
  return { ok: true, data: null };
}

export async function unpublishPost(id: string): Promise<Result<null>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .update({ status: "draft", published_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidateBlog((data as { slug: string } | null)?.slug);
  return { ok: true, data: null };
}

export async function deletePost(id: string): Promise<Result<null>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { data: row } = await admin.from("blog_posts").select("slug").eq("id", id).maybeSingle();
  const { error } = await admin.from("blog_posts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateBlog((row as { slug: string } | null)?.slug);
  return { ok: true, data: null };
}

/** Light pre-publish edit of the review-facing metadata fields. */
export async function updatePostMeta(
  id: string,
  patch: { title?: string; description?: string; slug?: string; tag?: string; keywords?: string[]; intro?: string }
): Promise<Result<{ slug: string }>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.title === "string" && patch.title.trim()) update.title = patch.title.trim();
  if (typeof patch.description === "string") update.description = patch.description.trim();
  if (typeof patch.tag === "string" && patch.tag.trim()) update.tag = patch.tag.trim().slice(0, 24);
  if (typeof patch.intro === "string" && patch.intro.trim()) update.intro = patch.intro.trim();
  if (Array.isArray(patch.keywords)) update.keywords = patch.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 10);

  let finalSlug: string | undefined;
  if (typeof patch.slug === "string" && patch.slug.trim()) {
    const desired = slugify(patch.slug);
    if (desired) {
      // Ensure uniqueness against other rows.
      const { data: clash } = await admin.from("blog_posts").select("id").eq("slug", desired).neq("id", id).maybeSingle();
      if (clash) return { ok: false, error: "That slug is already taken." };
      update.slug = desired;
      finalSlug = desired;
    }
  }

  const { data, error } = await admin.from("blog_posts").update(update).eq("id", id).select("slug").single();
  if (error) return { ok: false, error: error.message };
  const savedSlug = finalSlug ?? (data as { slug: string }).slug;
  revalidateBlog(savedSlug);
  return { ok: true, data: { slug: savedSlug } };
}
