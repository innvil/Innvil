import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WatchFooter } from "./WatchFooter";

/**
 * Public (signed-out) wrapper for the Help Center — deliberately lighter
 * than the authenticated `WatchShell` (no sidebar, no capacity/"needs
 * attention" data, since none of that exists for a visitor with no
 * account). Used only when `getSupportPageContext()` resolves
 * `authenticated: false`; a signed-in visitor still gets the full
 * `WatchShell` experience these pages had before. Same `.watch-root`
 * design-token scope as every other Watch surface.
 */
export function PublicDocsShell({ children, eyebrow = "Help Center" }: { children: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="watch-root min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0A0E11]/85 border-b w-line-soft">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/watch/app-tile.svg" alt="" width={32} height={32} className="w-8 h-8 rounded-[8px]" />
            <div className="leading-tight">
              <span className="w-display text-sm tracking-tight block">Innvil Watch</span>
              <span className="text-[10px] w-text-faint">{eyebrow}</span>
            </div>
          </Link>
          <nav className="flex items-center gap-4 text-sm w-text-dim shrink-0">
            <Link href="/" className="hover:w-text flex items-center gap-1.5">
              <ArrowLeft size={13} /> Back to Watch
            </Link>
            <Link href="/login" className="w-btn-primary text-xs font-semibold px-3.5 py-1.5 rounded-lg">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10">{children}</main>

      <WatchFooter />
    </div>
  );
}
