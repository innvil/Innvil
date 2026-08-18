import type { Metadata } from "next";
import { User, LifeBuoy } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { SupportContactForm } from "@/src/components/watch/SupportContactForm";

export const metadata: Metadata = { title: "Settings — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function SettingsPage() {
  const { accountId, admin } = await requireWatchPage();
  const [shell, { data: userRes }] = await Promise.all([
    getWatchShellContext(admin, accountId),
    admin.auth.admin.getUserById(accountId),
  ]);
  const email = userRes.user?.email ?? null;

  return (
    <WatchShell active="settings" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="w-display text-xl mb-1">Settings</h1>
          <p className="text-sm w-text-dim">Account details and support.</p>
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={User} title="Account" />
          <div className="text-sm">
            <p className="w-text-dim">Email</p>
            <p className="w-text mt-0.5">{email ?? "—"}</p>
          </div>
          <p className="text-xs w-text-faint mt-4">
            One Innvil account gives you access to Watch and other Innvil products you choose to use.
          </p>
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={LifeBuoy} title="Contact support" />
          <SupportContactForm />
        </div>
      </div>
    </WatchShell>
  );
}
