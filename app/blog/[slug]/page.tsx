import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowLeft, Clock } from "lucide-react";
import { BLOG_POSTS, type BlogPost } from "@/src/data/blog-posts";
import { getPublishedPost, relatedFor } from "@/src/lib/blog/data";
import { MarketingHeader, MarketingFooter } from "@/src/components/marketing/SiteChrome";
import { ArticleBody } from "@/src/components/blog/ArticleBody";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud").replace(/\/$/, "");

// Prebuild the static cornerstone guides; DB-published posts render on demand and
// are cached (ISR) so newly-approved drafts appear without a redeploy.
export const revalidate = 3600;

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) return { title: "Guide not found | Innvil", robots: { index: false, follow: false } };
  return {
    title: `${post.title} | Innvil`,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      type: "article",
      siteName: "Innvil",
      publishedTime: new Date(post.date + "T00:00:00Z").toISOString(),
      modifiedTime: new Date((post.updated ?? post.date) + "T00:00:00Z").toISOString(),
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ArticleJsonLd({ post }: { post: BlogPost }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${SITE}/blog/${post.slug}#article`,
    headline: post.title,
    description: post.description,
    datePublished: new Date(post.date + "T00:00:00Z").toISOString(),
    dateModified: new Date((post.updated ?? post.date) + "T00:00:00Z").toISOString(),
    keywords: post.keywords.join(", "),
    author: { "@type": "Organization", name: "Innvil", url: SITE },
    publisher: {
      "@type": "Organization",
      name: "Innvil",
      logo: { "@type": "ImageObject", url: `${SITE}/favicon.svg` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE}/blog/${post.slug}` },
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();

  const related = await relatedFor(slug);

  return (
    <div className="fp-root min-h-screen">
      <ArticleJsonLd post={post} />
      <MarketingHeader />

      <article className="max-w-3xl mx-auto px-6 pt-12 pb-16">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm fp-text-dim hover:fp-text mb-8">
          <ArrowLeft size={14} /> All guides
        </Link>

        <div className="flex items-center gap-3 text-xs fp-text-faint fp-mono mb-4">
          <span className="fp-gold-soft-bg fp-gold px-2 py-0.5 rounded-full">{post.tag}</span>
          <span>{fmtDate(post.date)}</span>
          <span className="flex items-center gap-1"><Clock size={12} /> {post.readMinutes} min read</span>
        </div>

        <h1 className="fp-display text-3xl md:text-4xl leading-[1.1] mb-6">{post.title}</h1>

        <ArticleBody intro={post.intro} sections={post.sections} />

        {post.cta && (
          <div className="fp-panel border fp-gold-border rounded-2xl p-6 md:p-8 mt-12">
            <h2 className="fp-display text-2xl mb-2">{post.cta.heading}</h2>
            <p className="fp-text-dim text-sm leading-relaxed mb-5">{post.cta.text}</p>
            <Link href="/signup" className="fp-btn-primary font-semibold px-6 py-3 rounded-lg inline-flex items-center gap-2 w-fit">
              Create your panel <ArrowRight size={16} />
            </Link>
          </div>
        )}

        {related.length > 0 && (
          <div className="mt-14 pt-10 border-t fp-line-soft">
            <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-5">Keep reading</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/blog/${r.slug}`}
                  className="fp-panel border fp-line rounded-xl p-5 hover:border-[#C9A574]/60 transition-colors group block"
                >
                  <h3 className="fp-display text-base mb-1.5 group-hover:text-[#C9A574] transition-colors">{r.title}</h3>
                  <span className="inline-flex items-center gap-1 text-xs fp-gold">
                    Read <ArrowRight size={12} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>

      <MarketingFooter />
    </div>
  );
}
