import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getSupportPageContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { PublicDocsShell } from "@/src/components/watch/PublicDocsShell";
import { HelpDocsNav, HelpDocsNavMobile } from "@/src/components/watch/HelpDocsNav";
import { ContactSupportCta } from "@/src/components/watch/HelpRightRail";
import { HELP_CATEGORIES, articlesByCategory, type HelpCategoryId } from "@/src/lib/watch-help/content";

function findCategory(id: string) {
  return HELP_CATEGORIES.find((c) => c.id === id) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const cat = findCategory(category);
  return {
    title: cat ? `${cat.label} — Innvil Watch Help` : "Help Center — Innvil Watch",
    description: cat?.description,
    icons: { icon: "/watch/app-tile.svg" },
  };
}

/** Category pages keep the fuller docs-navigation layout (left category
 *  nav) -- this is exactly where it earns its keep, letting a visitor move
 *  between documentation sections after they've already found one. No
 *  right rail here (the article list itself IS the page's main content;
 *  a "Get Started" rail next to it would just be another duplicate list).
 *  Public (per getSupportPageContext) -- a signed-in visitor still gets
 *  the full WatchShell app experience. */
export default async function HelpCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const cat = findCategory(category);
  if (!cat) notFound();

  const ctx = await getSupportPageContext();
  const articles = articlesByCategory(cat.id as HelpCategoryId);
  if (articles.length === 0) notFound(); // never a category page with nothing behind it

  const content = (
      <div className="flex gap-8 items-start">
        <HelpDocsNav active={cat.id} />

        <div className="flex-1 min-w-0 max-w-2xl">
          <HelpDocsNavMobile active={cat.id} />

          <nav aria-label="Breadcrumb" className="text-xs w-text-faint mb-4">
            <Link href="/support" className="hover:w-text-dim">Help Center</Link> <span className="mx-1">/</span> {cat.label}
          </nav>
          <h1 className="w-display text-xl mb-1">{cat.label}</h1>
          <p className="text-sm w-text-dim mb-6">{cat.description}</p>
          <div className="space-y-2 mb-8">
            {articles.map((a) => (
              <Link key={a.slug} href={`/support/${cat.id}/${a.slug}`} className="w-card p-4 hover:w-teal-border transition-colors flex items-center justify-between gap-3 block">
                <div className="min-w-0">
                  <p className="text-sm w-text">{a.title}</p>
                  <p className="text-xs w-text-faint truncate">{a.description}</p>
                </div>
                <ChevronRight size={14} className="w-text-faint shrink-0" />
              </Link>
            ))}
          </div>

          <ContactSupportCta compact />
        </div>
      </div>
  );

  if (ctx.authenticated) {
    return (
      <WatchShell active="support" capacity={ctx.shell.capacity} attentionCount={ctx.shell.attentionCount}>
        {content}
      </WatchShell>
    );
  }
  return <PublicDocsShell>{content}</PublicDocsShell>;
}
