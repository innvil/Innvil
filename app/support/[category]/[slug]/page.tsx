import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { HelpDocsNav, HelpDocsNavMobile } from "@/src/components/watch/HelpDocsNav";
import { HelpArticleRail, ContactSupportCta } from "@/src/components/watch/HelpRightRail";
import { HELP_CATEGORIES, getArticle, relatedArticles } from "@/src/lib/watch-help/content";

export async function generateMetadata({ params }: { params: Promise<{ category: string; slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  return {
    title: article ? `${article.title} — Innvil Watch Help` : "Help Center — Innvil Watch",
    description: article?.description,
    robots: { index: false },
    icons: { icon: "/watch/app-tile.svg" },
  };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params;
  const article = getArticle(slug);
  if (!article || article.category !== category) notFound();

  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);
  const cat = HELP_CATEGORIES.find((c) => c.id === article.category);
  const related = relatedArticles(article);

  return (
    <WatchShell active="support" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="flex gap-8 items-start">
        <HelpDocsNav active={article.category} />

        <div className="flex-1 min-w-0">
          <HelpDocsNavMobile active={article.category} />

          {/* Article prose keeps a comfortable reading measure even though
              this column itself is wider -- the extra room goes to the docs
              nav/rail, not to stretched paragraph lines. */}
          <div className="max-w-2xl">
            <nav aria-label="Breadcrumb" className="text-xs w-text-faint mb-4 flex items-center gap-1 flex-wrap">
              <Link href="/support" className="hover:w-text-dim">Help Center</Link>
              <ChevronRight size={11} />
              <Link href={`/support/${article.category}`} className="hover:w-text-dim">{cat?.label ?? article.category}</Link>
              <ChevronRight size={11} />
              <span className="w-text-dim">{article.title}</span>
            </nav>

            <article>
              <h1 className="w-display text-2xl mb-2">{article.title}</h1>
              <p className="text-sm w-text-dim mb-6">{article.description}</p>
              <div className="space-y-4">
                {article.body.map((p, i) => (
                  <p key={i} className="text-sm w-text leading-relaxed">{p}</p>
                ))}
              </div>
            </article>

            {/* Below `xl` the right rail is hidden, so Related lives here
                instead -- on `xl`+ it lives only in HelpArticleRail, never
                shown twice at once. */}
            {related.length > 0 && (
              <div className="xl:hidden mt-10 border-t w-line-soft pt-6">
                <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Related</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {related.map((r) => (
                    <Link key={r.slug} href={`/support/${r.category}/${r.slug}`} className="w-card p-3 hover:w-teal-border transition-colors flex items-center justify-between gap-2">
                      <span className="text-sm w-text">{r.title}</span>
                      <ChevronRight size={13} className="w-text-faint shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="xl:hidden mt-8">
              <ContactSupportCta compact />
            </div>
            <p className="mt-3 text-xs">
              <Link href="/support" className="w-teal hover:underline">← Back to Help Center</Link>
            </p>
          </div>
        </div>

        <HelpArticleRail related={related} />
      </div>
    </WatchShell>
  );
}
