import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { SupportContactForm } from "@/src/components/watch/SupportContactForm";

export const metadata: Metadata = { title: "Support — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

// Moved out of Settings (was a tab there) -- "how you get help" is its own
// concern from "how Watch behaves". Reachable via the sidebar's "Need help?"
// link, matching the account-menu/footer-link pattern rather than a Settings
// category.
export default async function SupportPage() {
  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);

  return (
    <WatchShell active="support" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="w-display text-xl mb-1">Support</h1>
          <p className="text-sm w-text-dim">Get help from the Innvil team.</p>
        </div>
        <div className="w-card p-5">
          <SectionHeader icon={LifeBuoy} title="Contact support" />
          <SupportContactForm />
        </div>
      </div>
    </WatchShell>
  );
}
