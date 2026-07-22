import Link from "next/link";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";

/**
 * Server-safe marketing header/footer shared by the blog (and any future static
 * marketing route). Mirrors the landing's TopNav/footer visually but has no client
 * state — the landing keeps its own copy because it also carries the (vestigial)
 * preview setWorld hook. Plain <Link>/<a> navigation only.
 */

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0A0B0F]/80 border-b fp-line-soft">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
            <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
          </div>
          <span className="fp-display text-lg tracking-wide">Innvil</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm fp-text-dim">
          <Link href="/#how" className="hover:fp-text">How it works</Link>
          <Link href="/#features" className="hover:fp-text">Features</Link>
          <Link href="/#pricing" className="hover:fp-text">Pricing</Link>
          <Link href="/blog" className="hover:fp-text">Guides</Link>
          <Link href="/#faq" className="hover:fp-text">FAQ</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm fp-text-dim">Log in</Link>
          <Link href="/signup" className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">
            Create your panel
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t fp-line-soft">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 fp-text-faint text-xs">
        <span>© 2026 Innvil — the white-label SMM panel builder.</span>
        <div className="flex items-center gap-5">
          <Link href="/blog" className="hover:fp-text">Guides</Link>
          <a href="/terms" className="hover:fp-text">Terms</a>
          <a href="/privacy" className="hover:fp-text">Privacy</a>
          <span className="fp-mono fp-text-faint">5% commission · no rent</span>
        </div>
      </div>
    </footer>
  );
}
