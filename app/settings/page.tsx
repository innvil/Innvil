import type { Metadata } from "next";
import Link from "next/link";
import { User, Bell, LifeBuoy, Settings as SettingsIcon } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getNotificationPreferences } from "@/src/lib/products/watch-notifications";
import { getAccountPreferences } from "@/src/lib/products/watch-account-preferences";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { WatchTabs, type WatchTab } from "@/src/components/watch/WatchTabs";
import { SupportContactForm } from "@/src/components/watch/SupportContactForm";
import { NotificationsSettingsCard } from "@/src/components/watch/NotificationsSettingsCard";
import { GeneralSettingsCard } from "@/src/components/watch/GeneralSettingsCard";

export const metadata: Metadata = { title: "Settings — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

// Account identity (email, connected Telegram identity) lives on /profile --
// "who the account is" -- Settings is "how Watch behaves". Only sections
// backed by real functionality are shown here: General (timezone/time
// format, migration 0076), a Profile pointer (never a duplicate identity
// card), real Notification preferences (one signal this codebase can
// honestly compute -- Needs Attention), and Support. Moderation Defaults
// and Auto-Posting defaults are NOT shown -- neither has any backend today
// (no default-persona inheritance mechanism, no account-scoped Auto-Posting
// at all) -- building UI for them would be exactly the "control with
// nothing behind it" fabrication this codebase's conventions forbid.
export default async function SettingsPage() {
  const { accountId, admin } = await requireWatchPage();
  const [shell, prefs, generalPrefs] = await Promise.all([
    getWatchShellContext(admin, accountId),
    getNotificationPreferences(admin, accountId),
    getAccountPreferences(admin, accountId),
  ]);

  const tabs: WatchTab[] = [
    {
      id: "general",
      label: "General",
      content: (
        <div className="w-card p-5">
          <SectionHeader icon={SettingsIcon} title="General" />
          <GeneralSettingsCard initial={generalPrefs} />
        </div>
      ),
    },
    {
      id: "profile",
      label: "Profile",
      content: (
        <Link href="/profile" className="w-card p-5 flex items-center justify-between gap-3 group hover:w-teal-border border border-transparent max-w-lg">
          <span className="flex items-center gap-2.5">
            <User size={15} className="w-teal" />
            <span>
              <span className="w-display text-sm block">Account identity</span>
              <span className="text-xs w-text-faint">Email and connected accounts live on your Profile.</span>
            </span>
          </span>
          <span className="text-xs w-teal group-hover:underline shrink-0">Open Profile</span>
        </Link>
      ),
    },
    {
      id: "notifications",
      label: "Notifications",
      content: (
        <div className="w-card p-5">
          <SectionHeader icon={Bell} title="Notifications" />
          <NotificationsSettingsCard initialEnabled={prefs.attentionAlertsEnabled} />
        </div>
      ),
    },
    {
      id: "support",
      label: "Support",
      content: (
        <div className="w-card p-5 max-w-lg">
          <SectionHeader icon={LifeBuoy} title="Contact support" />
          <SupportContactForm />
        </div>
      ),
    },
  ];

  return (
    <WatchShell active="settings" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6">
        <div>
          <h1 className="w-display text-xl mb-1">Settings</h1>
          <p className="text-sm w-text-dim">General preferences, notifications, account identity, and support.</p>
        </div>
        <WatchTabs tabs={tabs} defaultTab="general" />
      </div>
    </WatchShell>
  );
}
