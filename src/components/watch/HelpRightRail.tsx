import Link from "next/link";
import { LifeBuoy, ChevronRight } from "lucide-react";
import { type HelpArticle } from "@/src/lib/watch-help/content";

/**
 * Compact "still need help" CTA — a link into the ONE real Contact Support
 * page (`/support/contact`), never a second embedded copy of the actual
 * form. Used everywhere the Help Center wants to offer the fallback
 * (home, category, article) without repeating a full form on every page.
 */
export function ContactSupportCta({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link href="/support/contact" className="w-card p-4 flex items-center justify-between gap-3 hover:w-teal-border transition-colors">
        <span className="text-sm w-text flex items-center gap-1.5"><LifeBuoy size={14} className="w-teal" /> Still need help?</span>
        <span className="text-xs w-teal shrink-0 flex items-center gap-1">Contact Support <ChevronRight size={12} /></span>
      </Link>
    );
  }
  return (
    <div className="w-card p-5 text-center">
      <LifeBuoy size={18} className="w-teal mx-auto mb-2" />
      <p className="text-sm w-text mb-1">Still need help?</p>
      <p className="text-xs w-text-faint mb-4">Can&apos;t find the answer you&apos;re looking for?</p>
      <Link href="/support/contact" className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg inline-block">
        Contact Support
      </Link>
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

/** Right rail for an article page — related articles (already computed by
 *  the caller) + the compact contact CTA. No "On this page" TOC: this
 *  content model is flat paragraphs with no internal sub-headings, so a
 *  per-article TOC would have no real anchors to link to — omitted rather
 *  than faked. Hidden below `xl` (a laptop-width viewport doesn't have room
 *  for a third column without cramping the main content); the same
 *  Related/contact content renders inline on the article page itself below
 *  `xl` instead, never both at once. */
export function HelpArticleRail({ related }: { related: HelpArticle[] }) {
  return (
    <aside className="hidden xl:block w-64 shrink-0">
      <div className="sticky top-24 space-y-4">
        <QuickLinks title="Related" articles={related} />
        <ContactSupportCta compact />
      </div>
    </aside>
  );
}
