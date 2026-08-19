import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { HELP_CATEGORIES, articlesByCategory, type HelpCategoryId } from "@/src/lib/watch-help/content";

function findCategory(id: string) {
  return HELP_CATEGORIES.find((c) => c.id === id) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const cat = findCategory(category);
  return { title: cat ? `${cat.label} — Innvil Watch Help` : "Help Center — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };
}

export default async function HelpCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const cat = findCategory(category);
  if (!cat) notFound();

  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);
  const articles = articlesByCategory(cat.id as HelpCategoryId);
  if (articles.length === 0) notFound(); // never a category page with nothing behind it

  return (
    <WatchShell active="support" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="max-w-2xl">
        <nav aria-label="Breadcrumb" className="text-xs w-text-faint mb-4">
          <Link href="/support" className="hover:w-text-dim">Help Center</Link> <span className="mx-1">/</span> {cat.label}
        </nav>
        <h1 className="w-display text-xl mb-1">{cat.label}</h1>
        <p className="text-sm w-text-dim mb-6">{cat.description}</p>
        <div className="space-y-2">
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
      </div>
    </WatchShell>
  );
}
