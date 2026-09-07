"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { searchArticles, HELP_CATEGORIES } from "@/src/lib/watch-help/content";

/** Local, client-side search over the Help Center's own small article set
 *  (searchArticles is a pure, no-I/O function -- no network round trip, no
 *  external search service). Empty/no-match states are real, not hidden. */
export function HelpSearch() {
  const [query, setQuery] = useState("");
  const results = query.trim() ? searchArticles(query) : [];
  const categoryLabel = (id: string) => HELP_CATEGORIES.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="relative max-w-lg mx-auto">
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-text-faint" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Innvil Watch help…"
          aria-label="Search Innvil Watch help"
          className="w-full w-surface-raised border w-line-soft rounded-lg pl-10 pr-9 py-3 text-sm outline-none focus:w-teal-border"
        />
        {query && (
          <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 w-text-faint hover:w-text">
            <X size={14} />
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="mt-2 w-card-raised border w-line-soft rounded-lg overflow-hidden text-left">
          {results.length > 0 ? (
            <ul>
              {results.map((a) => (
                <li key={a.slug} className="border-b w-line-soft last:border-b-0">
                  <Link href={`/support/${a.category}/${a.slug}`} className="block px-4 py-2.5 hover:w-surface-raised">
                    <p className="text-sm w-text">{a.title}</p>
                    <p className="text-[11px] w-text-faint">{categoryLabel(a.category)} · {a.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-4 text-sm w-text-dim">
              No matching help articles. Try a different search, browse categories below, or contact support.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
