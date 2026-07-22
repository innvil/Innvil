import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud").replace(/\/$/, "");

/* Innvil marketing/site pages. Per-panel storefronts live on their own
   subdomains/custom domains and self-manage SEO, so they're intentionally not
   listed here. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
