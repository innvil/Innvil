import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getSupportPageContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { PublicDocsShell } from "@/src/components/watch/PublicDocsShell";
import { HelpSearch } from "@/src/components/watch/HelpSearch";
import { ContactSupportCta } from "@/src/components/watch/HelpRightRail";
import { HELP_CATEGORIES, popularArticles, articlesByCategory } from "@/src/lib/watch-help/content";

export const metadata: Metadata = {
  title: "Help Center — Innvil Watch",
  description: "Documentation for Innvil Watch — Watchers, moderation, Smart Escalation, plans, and billing.",
  icons: { icon: "/watch/app-tile.svg" },
};

/**
 * Innvil Watch Help Center HOME — public documentation, reachable without
 * signing in (per explicit product decision: docs should be accessible
 * outside the authenticated app, linked from the footer). A signed-in
 * visitor still gets the full `WatchShell` app experience; a signed-out
 * one gets the lighter `PublicDocsShell`.
 *
 * Deliberately simple: Search -> Popular -> Browse by category -> Contact
 * Support. No internal docs sidebar and no right-rail article list here —
 * the fuller docs-navigation layout (left category nav + right rail) is
 * kept on category/article pages, where a visitor benefits from moving
 * between documentation sections after they've already found one.
 */
export default async function SupportPage() {
  const ctx = await getSupportPageContext();
  const popular = popularArticles();

  const content = (
    <div className="max-w-4xl mx-auto space-y-10">
        <div className="max-w-lg mx-auto text-center">
          <h1 className="w-display text-2xl mb-2">Need help?</h1>
          <p className="text-sm w-text-dim mb-6">Search the Innvil Watch Help Center, or browse a category below.</p>
          <HelpSearch />
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Popular</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {popular.map((a) => (
              <Link key={a.slug} href={`/support/${a.category}/${a.slug}`} className="w-card p-3.5 hover:w-teal-border transition-colors flex items-center justify-between gap-2">
                <span className="text-sm w-text">{a.title}</span>
                <ChevronRight size={14} className="w-text-faint shrink-0" />
              </Link>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Browse by category</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {HELP_CATEGORIES.map((cat) => {
              const count = articlesByCategory(cat.id).length;
              if (count === 0) return null; // never a category link with nothing behind it
              return (
                <Link key={cat.id} href={`/support/${cat.id}`} className="w-card p-4 hover:w-teal-border transition-colors">
                  <p className="w-display text-sm mb-1">{cat.label}</p>
                  <p className="text-xs w-text-dim mb-2">{cat.description}</p>
                  <p className="text-[11px] w-text-faint">{count} article{count === 1 ? "" : "s"}</p>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="max-w-lg mx-auto">
          <ContactSupportCta />
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
