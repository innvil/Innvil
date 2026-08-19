import Link from "next/link";
import { LifeBuoy, ChevronRight } from "lucide-react";
import { SupportContactForm } from "./SupportContactForm";
import { getArticle, type HelpArticle } from "@/src/lib/watch-help/content";

const GET_STARTED_SLUGS = ["what-is-a-watcher", "connect-your-telegram-account", "start-the-free-trial"];

/** Compact "still need help" block, reused across the Help Center home,
 *  category pages, and article pages -- the SAME existing account-scoped
 *  `SupportContactForm`, never a second contact mechanism. Kept intentionally
 *  small here (this is the fallback, not the dominant page feature). */
export function ContactSupportRail() {
  return (
    <div className="w-card p-4">
      <p className="text-sm w-text flex items-center gap-1.5 mb-1"><LifeBuoy size={14} className="w-teal" /> Still need help?</p>
      <p className="text-xs w-text-faint mb-3">If the docs don&apos;t answer your question, contact support.</p>
      <SupportContactForm />
    </div>
  );
}

function QuickLinks({ title, articles }: { title: string; articles: HelpArticle[] }) {
  if (articles.length === 0) return null;
  return (
    <div className="w-card p-4">
      <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2.5">{title}</p>
      <div className="space-y-0.5">
        {articles.map((a) => (
          <Link key={a.slug} href={`/support/${a.category}/${a.slug}`} className="flex items-center justify-between gap-2 text-sm w-text-dim hover:w-text px-1.5 py-1.5 rounded-md hover:w-surface-raised transition-colors">
            {a.title}
            <ChevronRight size={12} className="w-text-faint shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Right rail for the Help Center home — real navigation/context, not
 *  decorative filler: a short "get started" set + the contact fallback.
 *  Hidden below `xl` (a laptop-width viewport doesn't have room for a third
 *  column without cramping the main content). */
export function HelpHomeRail() {
  const getStarted = GET_STARTED_SLUGS.map((s) => getArticle(s)).filter((a): a is HelpArticle => a != null);
  return (
    <aside className="hidden xl:block w-64 shrink-0">
      <div className="sticky top-24 space-y-4">
        <QuickLinks title="Get started" articles={getStarted} />
        <ContactSupportRail />
      </div>
    </aside>
  );
}

/** Right rail for an article page — related articles (already computed by
 *  the caller) + the same contact fallback. No "On this page" TOC: this
 *  content model is flat paragraphs with no internal sub-headings, so a
 *  per-article TOC would have no real anchors to link to — omitted rather
 *  than faked. */
export function HelpArticleRail({ related }: { related: HelpArticle[] }) {
  return (
    <aside className="hidden xl:block w-64 shrink-0">
      <div className="sticky top-24 space-y-4">
        <QuickLinks title="Related" articles={related} />
        <ContactSupportRail />
      </div>
    </aside>
  );
}
