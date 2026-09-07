import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { BLOG_POSTS, type BlogPost, type BlogSection } from "@/src/data/blog-posts";

/* =========================================================
   Blog read layer (public, SSR).
   Merges the hand-written cornerstone guides in src/data/blog-posts.ts with
   PUBLISHED rows from the blog_posts table (AI-drafted, human-approved). Static
   posts win on slug collision. All DB access is wrapped so a build with no/empty
   DB simply serves the static posts — the pages never break.
   ========================================================= */

interface BlogPostRow {
  slug: string;
  title: string;
  description: string;
  tag: string;
  keywords: string[] | null;
  intro: string;
  sections: unknown;
  cta: unknown;
  related: string[] | null;
  read_minutes: number;
  published_at: string | null;
  created_at: string;
}

function toSections(v: unknown): BlogSection[] {
  return Array.isArray(v) ? (v as BlogSection[]) : [];
}

function toCta(v: unknown): BlogPost["cta"] {
  if (v && typeof v === "object") {
    const h = (v as { heading?: unknown }).heading;
    const t = (v as { text?: unknown }).text;
    if (typeof h === "string" && typeof t === "string") return { heading: h, text: t };
  }
  return undefined;
}

function rowToPost(r: BlogPostRow): BlogPost {
  const dateSource = r.published_at ?? r.created_at;
  return {
    slug: r.slug,
    title: r.title,
    description: r.description,
    date: dateSource.slice(0, 10),
    updated: dateSource.slice(0, 10),
    readMinutes: r.read_minutes,
    tag: r.tag,
    keywords: r.keywords ?? [],
    intro: r.intro,
    sections: toSections(r.sections),
    cta: toCta(r.cta),
    related: r.related ?? [],
  };
}

async function fetchPublishedRows(): Promise<BlogPost[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("blog_posts")
      .select("slug, title, description, tag, keywords, intro, sections, cta, related, read_minutes, published_at, created_at")
      .eq("status", "published")
      .order("published_at", { ascending: false });
    if (error || !data) return [];
    return (data as BlogPostRow[]).map(rowToPost);
  } catch {
    return [];
  }
}

/** All visible posts (static + published DB), newest-first, deduped by slug. */
export async function listPublishedPosts(): Promise<BlogPost[]> {
  const dbPosts = await fetchPublishedRows();
  const staticSlugs = new Set(BLOG_POSTS.map((p) => p.slug));
  const merged = [...BLOG_POSTS, ...dbPosts.filter((p) => !staticSlugs.has(p.slug))];
  return merged.sort((a, b) => ((a.updated ?? a.date) < (b.updated ?? b.date) ? 1 : -1));
}

export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  const all = await listPublishedPosts();
  return all.find((p) => p.slug === slug) ?? null;
}

/** Related posts for an article: curated `related` slugs if set, else the newest others. */
export async function relatedFor(slug: string, limit = 2): Promise<BlogPost[]> {
  const all = await listPublishedPosts();
  const post = all.find((p) => p.slug === slug);
  if (!post) return [];
  if (post.related && post.related.length) {
    const bySlug = new Map(all.map((p) => [p.slug, p]));
    const picked = post.related.map((s) => bySlug.get(s)).filter((p): p is BlogPost => Boolean(p));
    if (picked.length) return picked.slice(0, limit);
  }
  return all.filter((p) => p.slug !== slug).slice(0, limit);
}
