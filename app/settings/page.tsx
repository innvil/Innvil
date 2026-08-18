import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy, User } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { SupportContactForm } from "@/src/components/watch/SupportContactForm";

export const metadata: Metadata = { title: "Settings — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

// Account identity (email, connected Telegram identity) lives on /profile --
// "who the account is" -- Settings is "how Watch behaves" (currently just
// support). Kept as a single pointer link rather than duplicating the
// Account card here, per the explicit "do not duplicate the same identity
// card in both pages" instruction.
export default async function SettingsPage() {
  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);

  return (
    <WatchShell active="settings" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="w-display text-xl mb-1">Settings</h1>
          <p className="text-sm w-text-dim">Support and how Watch behaves.</p>
        </div>

        <Link href="/profile" className="w-card p-5 flex items-center justify-between gap-3 group hover:w-teal-border border border-transparent">
          <span className="flex items-center gap-2.5">
            <User size={15} className="w-teal" />
            <span>
              <span className="w-display text-sm block">Account identity</span>
              <span className="text-xs w-text-faint">Email and connected accounts live on your Profile.</span>
            </span>
          </span>
          <span className="text-xs w-teal group-hover:underline shrink-0">Open Profile</span>
        </Link>

        <div className="w-card p-5">
          <SectionHeader icon={LifeBuoy} title="Contact support" />
          <SupportContactForm />
        </div>
      </div>
    </WatchShell>
  );
}
