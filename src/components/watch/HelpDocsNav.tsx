import Link from "next/link";
import { HELP_CATEGORIES, articlesByCategory, type HelpCategoryId } from "@/src/lib/watch-help/content";

/**
 * Internal Help Center docs navigation — deliberately distinct from (and
 * quieter than) the main `WatchShell` application sidebar: no icons, no
 * heavy borders, smaller text. Server-rendered (no client state needed —
 * "active" comes from the current route via a prop), sticky on desktop.
 * Categories with zero real articles are never listed here either, same
 * rule as the Help Center home's category grid.
 */
export function HelpDocsNav({ active }: { active?: HelpCategoryId }) {
  const categories = HELP_CATEGORIES.filter((c) => articlesByCategory(c.id).length > 0);
  return (
    <nav aria-label="Help Center categories" className="hidden lg:block w-44 shrink-0">
      <div className="sticky top-24 space-y-0.5">
        <Link
          href="/support"
          className={`block px-3 py-1.5 rounded-md text-xs transition-colors ${!active ? "w-teal-soft-bg w-teal font-medium" : "w-text-faint hover:w-text-dim"}`}
        >
          Help Center
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/support/${c.id}`}
            aria-current={active === c.id ? "page" : undefined}
            className={`block px-3 py-1.5 rounded-md text-xs transition-colors ${active === c.id ? "w-teal-soft-bg w-teal font-medium" : "w-text-dim hover:w-text hover:w-surface-raised"}`}
          >
            {c.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** Mobile/tablet fallback for the same nav -- a horizontal, scrollable pill
 *  row instead of a vertical rail (no drawer/overlay complexity, no nested
 *  scroll trap; simply hidden at `lg` and up where the real rail takes
 *  over). */
export function HelpDocsNavMobile({ active }: { active?: HelpCategoryId }) {
  const categories = HELP_CATEGORIES.filter((c) => articlesByCategory(c.id).length > 0);
  return (
    <div className="lg:hidden -mx-4 px-4 sm:mx-0 sm:px-0 mb-6 overflow-x-auto">
      <div className="flex items-center gap-2 w-max sm:w-auto sm:flex-wrap pb-1">
        <Link
          href="/support"
          className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${!active ? "w-teal-border w-teal-soft-bg w-teal" : "w-line-soft w-text-faint hover:w-text-dim"}`}
        >
          Help Center
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/support/${c.id}`}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${active === c.id ? "w-teal-border w-teal-soft-bg w-teal" : "w-line-soft w-text-faint hover:w-text-dim"}`}
          >
            {c.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
