import type { MetadataRoute } from "next";
import { listPublishedPosts } from "@/src/lib/blog/data";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud").replace(/\/$/, "");

/* Innvil marketing/site pages. Per-panel storefronts live on their own
   subdomains/custom domains and self-manage SEO, so they're intentionally not
   listed here. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const posts = (await listPublishedPosts()).map((p): MetadataRoute.Sitemap[number] => ({
    url: `${SITE}/blog/${p.slug}`,
    lastModified: new Date((p.updated ?? p.date) + "T00:00:00Z"),
    changeFrequency: "monthly",
    priority: 0.7,
  }));
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...posts,
    { url: `${SITE}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
