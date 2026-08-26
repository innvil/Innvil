import React from "react";
import Link from "next/link";

/**
 * Shared multi-column footer for Innvil Watch's public surfaces (the
 * landing page and the public Help Center) — per explicit product
 * decision: documentation should be reachable outside the authenticated
 * app, and the footer is the standing entry point into it (Product /
 * Resources / Company / Account), not just the landing's own nav anchors.
 *
 * Every link points at a REAL destination — no invented Changelog/Status/
 * About pages, and no fabricated contact email (the only address on file,
 * RESEND_FROM, is a `noreply@` sending address, never a real inbound
 * contact). "Contact" links to the existing account-scoped contact page
 * (`/support/contact`) — a signed-out visitor is asked to sign in first,
 * matching how every other authenticated action in this app already
 * behaves, rather than a second, parallel anonymous contact form.
 */
export function WatchFooter() {
  return (
    <footer className="border-t w-line-soft py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
          <div>
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Product</p>
            <ul className="space-y-2 text-sm w-text-dim">
              <li><a href="/#features" className="hover:w-text">Features</a></li>
              <li><a href="/#pricing" className="hover:w-text">Pricing</a></li>
              <li><a href="/#how" className="hover:w-text">How it works</a></li>
              <li><Link href="/why-watchers" className="hover:w-text">Virtual Moderators</Link></li>
              <li><Link href="/support/escalation/smart-escalation" className="hover:w-text">Smart Escalation</Link></li>
              <li><Link href="/support/moderation/media-moderation" className="hover:w-text">Media Moderation</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Resources</p>
            <ul className="space-y-2 text-sm w-text-dim">
              <li><Link href="/support" className="hover:w-text">Documentation</Link></li>
              <li><Link href="/support/getting-started/getting-started-path" className="hover:w-text">Getting Started</Link></li>
              <li><Link href="/support/faq/faq" className="hover:w-text">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Company</p>
            <ul className="space-y-2 text-sm w-text-dim">
              <li><Link href="/support/contact" className="hover:w-text">Contact</Link></li>
              <li><Link href="/terms" className="hover:w-text">Terms of Service</Link></li>
              <li><Link href="/privacy" className="hover:w-text">Privacy Policy</Link></li>
              <li><a href="https://innvil.cloud" className="hover:w-text">Innvil</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Account</p>
            <ul className="space-y-2 text-sm w-text-dim">
              <li><Link href="/login" className="hover:w-text">Sign in</Link></li>
              <li><Link href="/signup" className="hover:w-text">Start Free Trial</Link></li>
              <li><Link href="/" className="hover:w-text">Dashboard</Link></li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-6 border-t w-line-soft">
          <div>
            <p className="w-display text-sm">Innvil Watch</p>
            <p className="text-xs w-text-faint">Virtual Moderators for Telegram communities.</p>
          </div>
          <p className="text-xs w-text-faint">© {new Date().getFullYear()} Innvil Watch. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
