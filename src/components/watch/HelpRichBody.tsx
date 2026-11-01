import React from "react";
import type { HelpBlock } from "@/src/lib/watch-help/content";

/**
 * Renders an article's optional `richBody` (tables/headings/callouts/cards/
 * lists) — an ADDITIVE capability layered on top of the existing plain
 * `body: string[]` paragraph rendering, not a redesign of the Help Center
 * portal. Only articles that opt into `richBody` use this; every other
 * article keeps rendering via the plain `body.map(p => <p>)` loop in
 * app/support/[category]/[slug]/page.tsx, completely unchanged.
 */
export function HelpRichBody({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return (
              <h2 key={i} id={b.id} className="w-display text-lg w-text pt-4 scroll-mt-24">
                {b.text}
              </h2>
            );
          case "paragraph":
            return (
              <p key={i} className="text-sm w-text leading-relaxed">
                {b.text}
              </p>
            );
          case "callout":
            return (
              <div key={i} className={`w-card p-4 border ${b.tone === "warning" ? "w-amber-border" : "w-teal-border"}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${b.tone === "warning" ? "w-amber" : "w-teal"}`}>{b.title}</p>
                <p className="text-sm w-text-dim leading-relaxed">{b.text}</p>
              </div>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto -mx-1 w-card p-0">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="border-b w-line-soft">
                      {b.headers.map((h, hi) => (
                        <th key={hi} className="text-left font-semibold text-[11px] uppercase tracking-wide w-text-faint px-3 py-2.5">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri} className={ri < b.rows.length - 1 ? "border-b w-line-soft" : ""}>
                        {row.map((cell, ci) => (
                          <td key={ci} className={`px-3 py-2.5 ${ci === 0 ? "w-text font-medium" : "w-text-dim"}`}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "cards":
            return (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {b.items.map((card, ci) => (
                  <div key={ci} className="w-card p-4">
                    <p className="w-display text-sm w-text mb-2">{card.title}</p>
                    <ul className="space-y-1">
                      {card.lines.map((line, li) => (
                        <li key={li} className="text-xs w-text-dim">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          case "list":
            return (
              <ul key={i} className="list-disc pl-5 space-y-1">
                {b.items.map((item, li) => (
                  <li key={li} className="text-sm w-text-dim leading-relaxed">
                    {item}
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}

/** "On this page" anchor nav — derived from the SAME heading blocks the
 *  article body renders, so the nav can never drift out of sync with what
 *  the page actually contains (no separately-maintained list of anchors). */
export function HelpOnThisPage({ blocks }: { blocks: HelpBlock[] }) {
  const headings = blocks.filter((b): b is Extract<HelpBlock, { type: "heading" }> => b.type === "heading");
  if (headings.length === 0) return null;
  return (
    <div className="w-card p-4 mb-2">
      <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2">On this page</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {headings.map((h) => (
          <a key={h.id} href={`#${h.id}`} className="text-xs w-teal hover:underline">
            {h.text}
          </a>
        ))}
      </div>
    </div>
  );
}
