import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { allPosts } from "@/src/data/blog-posts";
import { MarketingHeader, MarketingFooter } from "@/src/components/marketing/SiteChrome";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "SMM Panel Guides — How to Start, Compare & Price a Panel | Innvil",
  description:
    "Practical guides on starting and running an SMM panel: step-by-step launch walkthroughs, white-label vs. script comparisons, real cost breakdowns, and more from Innvil.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "SMM Panel Guides | Innvil",
    description: "How to start, compare, and price your own SMM panel.",
    url: "/blog",
    type: "website",
    siteName: "Innvil",
  },
};

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function BlogIndexJsonLd() {
  const posts = allPosts();
  const graph = [
    {
      "@type": "Blog",
      "@id": `${SITE}/blog#blog`,
      name: "Innvil SMM Panel Guides",
      url: `${SITE}/blog`,
      description: "Guides on starting and running an SMM panel.",
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@type": "ItemList",
      itemListElement: posts.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE}/blog/${p.slug}`,
        name: p.title,
      })),
    },
  ];
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }) }}
    />
  );
}

export default function BlogIndex() {
  const posts = allPosts();
  return (
    <div className="fp-root min-h-screen">
      <BlogIndexJsonLd />
      <MarketingHeader />

      <section className="fp-noise fp-grid-bg border-b fp-line-soft">
        <div className="max-w-4xl mx-auto px-6 pt-16 pb-12">
          <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">Guides</p>
          <h1 className="fp-display text-4xl md:text-5xl leading-[1.05]">
            Everything you need to <span className="fp-grad-text">start an SMM panel.</span>
          </h1>
          <p className="fp-text-dim text-base mt-5 max-w-2xl leading-relaxed">
            Straight-talking guides on launching, comparing, and pricing an SMM panel — written for
            resellers who want a real business, not a get-rich-quick scheme.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-14">
        <div className="grid gap-5">
          {posts.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="fp-panel border fp-line rounded-2xl p-6 md:p-7 hover:border-[#C9A574]/60 transition-colors group block"
            >
              <div className="flex items-center gap-3 text-xs fp-text-faint fp-mono mb-3">
                <span className="fp-gold-soft-bg fp-gold px-2 py-0.5 rounded-full">{p.tag}</span>
                <span>{fmtDate(p.date)}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {p.readMinutes} min read</span>
              </div>
              <h2 className="fp-display text-2xl mb-2 group-hover:text-[#C9A574] transition-colors">{p.title}</h2>
              <p className="fp-text-dim text-sm leading-relaxed">{p.description}</p>
              <span className="inline-flex items-center gap-1.5 text-sm fp-gold mt-4">
                Read the guide <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
