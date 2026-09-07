import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { SupportContactForm } from "@/src/components/watch/SupportContactForm";

export const metadata: Metadata = { title: "Contact Support — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

/** The ONE place the real support form is ever rendered — every other
 *  "Still need help?" surface in the Help Center (home, category, article)
 *  is a compact link into this page, never a second embedded copy of the
 *  form. Same existing account-scoped `SupportContactForm`/
 *  `sendOwnerSupportMessage` channel, unchanged. */
export default async function SupportContactPage() {
  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);

  return (
    <WatchShell active="support" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="max-w-lg">
        <nav aria-label="Breadcrumb" className="text-xs w-text-faint mb-4">
          <Link href="/support" className="hover:w-text-dim">Help Center</Link> <span className="mx-1">/</span> Contact Support
        </nav>
        <div className="w-card p-5">
          <SectionHeader icon={LifeBuoy} title="Contact support" />
          <p className="text-xs w-text-faint mb-4">Can&apos;t find the answer in the Help Center? Send the Innvil team a message directly.</p>
          <SupportContactForm />
        </div>
      </div>
    </WatchShell>
  );
}
