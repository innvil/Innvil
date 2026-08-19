import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { HelpSearch } from "@/src/components/watch/HelpSearch";
import { HelpDocsNav, HelpDocsNavMobile } from "@/src/components/watch/HelpDocsNav";
import { HelpHomeRail, ContactSupportRail } from "@/src/components/watch/HelpRightRail";
import { HELP_CATEGORIES, popularArticles, articlesByCategory } from "@/src/lib/watch-help/content";

export const metadata: Metadata = { title: "Help Center — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

/**
 * Innvil Watch Help Center — a real self-service documentation hub, not
 * just a contact form. "Need help?" leads here first; Contact Support
 * stays available as the fallback (right rail on wide desktop, a card
 * below the main content on narrower viewports where the rail collapses).
 *
 * Three-column docs layout (matches the shell's own 1400px content width
 * instead of self-constraining to a narrow blog-like column): a quiet
 * internal docs nav on the left, the main Help Center content in the
 * middle, and a real right rail (quick links + contact) on wide desktop.
 */
export default async function SupportPage() {
  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);
  const popular = popularArticles();

  return (
    <WatchShell active="support" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="flex gap-8 items-start">
        <HelpDocsNav />

        <div className="flex-1 min-w-0 space-y-8">
          <HelpDocsNavMobile />

          <div className="max-w-lg text-center mx-auto xl:mx-0 xl:text-left">
            <h1 className="w-display text-2xl mb-2">Need help?</h1>
            <p className="text-sm w-text-dim mb-6">Search the Innvil Watch Help Center, or browse a category below.</p>
          </div>
          <div className="max-w-lg mx-auto xl:mx-0">
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
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Categories</p>
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

          {/* The real right rail (below) only shows at `xl` and up -- give
              narrower viewports the same contact fallback inline instead of
              losing it entirely. */}
          <div className="xl:hidden max-w-lg">
            <ContactSupportRail />
          </div>
        </div>

        <HelpHomeRail />
      </div>
    </WatchShell>
  );
}
