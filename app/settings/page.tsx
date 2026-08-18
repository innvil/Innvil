import type { Metadata } from "next";
import { Bell, Settings as SettingsIcon, ShieldCheck, Lock } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getNotificationPreferences } from "@/src/lib/products/watch-notifications";
import { getAccountPreferences } from "@/src/lib/products/watch-account-preferences";
import { getModerationDefaults } from "@/src/lib/products/watch-moderation-defaults";
import { timezoneLabel } from "@/src/lib/products/watch-datetime";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { SettingsSectionNav } from "@/src/components/watch/SettingsSectionNav";
import { SettingsSummary } from "@/src/components/watch/SettingsSummary";
import type { WatchTab } from "@/src/components/watch/WatchTabs";
import { NotificationsSettingsCard } from "@/src/components/watch/NotificationsSettingsCard";
import { GeneralSettingsCard } from "@/src/components/watch/GeneralSettingsCard";
import { ModerationDefaultsCard } from "@/src/components/watch/ModerationDefaultsCard";
import { SecuritySettingsCard } from "@/src/components/watch/SecuritySettingsCard";

export const metadata: Metadata = { title: "Settings — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

// Settings = "how Watch behaves" only. Profile ("who you are") and Support
// ("how you get help") stay OUT of here -- Profile has its own sidebar
// entry, Support is its own /support route reachable via the sidebar's
// "Need help?" link. Sections shown are only ones backed by real
// functionality: General (timezone/time format, migration 0076),
// Notifications (three real categories mapped onto listAccountAttentionItems's
// own severity partition, migration 0078), Moderation (the real persona a
// NEW Watcher starts from, migration 0077), and Security (Change Password +
// real email-verification/sign-in-method state, zero new backend beyond the
// existing actions/account.ts). No "Telegram" section exists yet --
// investigated, no real account-level Telegram BEHAVIOR configuration
// exists today (bot_ack_mode is per-Community only).
export default async function SettingsPage() {
  const { accountId, admin } = await requireWatchPage();
  const [shell, notificationPrefs, generalPrefs, moderationDefaults, userRes] = await Promise.all([
    getWatchShellContext(admin, accountId),
    getNotificationPreferences(admin, accountId),
    getAccountPreferences(admin, accountId),
    getModerationDefaults(admin, accountId),
    admin.auth.admin.getUserById(accountId),
  ]);

  const notificationsEnabledCount = [
    notificationPrefs.noActiveWatcherEnabled, notificationPrefs.capacityWarningEnabled, notificationPrefs.watcherStatusEnabled,
  ].filter(Boolean).length;
  const moderationConfigured = Boolean(
    moderationDefaults.presetId || moderationDefaults.description.trim() || moderationDefaults.customInstructions.trim()
  );
  const emailVerified = Boolean(userRes.data.user?.email_confirmed_at);

  const tabs: WatchTab[] = [
    {
      id: "general",
      label: "General",
      content: (
        <div className="w-card p-5">
          <SectionHeader icon={SettingsIcon} title="General" />
          <p className="text-xs w-text-faint -mt-2 mb-4">Account-wide display and time preferences.</p>
          <GeneralSettingsCard initial={generalPrefs} />
        </div>
      ),
    },
    {
      id: "notifications",
      label: "Notifications",
      content: (
        <div className="w-card p-5">
          <SectionHeader icon={Bell} title="Notifications" />
          <p className="text-xs w-text-faint -mt-2 mb-4">Choose which account-wide operational alerts you want to receive.</p>
          <NotificationsSettingsCard initial={notificationPrefs} />
        </div>
      ),
    },
    {
      id: "moderation",
      label: "Moderation",
      content: (
        <div className="w-card p-5">
          <SectionHeader icon={ShieldCheck} title="Moderation" />
          <p className="text-xs w-text-faint -mt-2 mb-4">Defaults applied when creating new Watchers.</p>
          <ModerationDefaultsCard initial={moderationDefaults} />
        </div>
      ),
    },
    {
      id: "security",
      label: "Security",
      content: (
        <div className="w-card p-5">
          <SectionHeader icon={Lock} title="Security" />
          <p className="text-xs w-text-faint -mt-2 mb-4">Manage authentication and account security.</p>
          <SecuritySettingsCard emailVerified={emailVerified} />
        </div>
      ),
    },
  ];

  return (
    <WatchShell active="settings" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6">
        <div>
          <h1 className="w-display text-xl mb-1">Settings</h1>
          <p className="text-sm w-text-dim">Configure account-wide behavior for Innvil Watch.</p>
        </div>
        <SettingsSummary
          timezone={timezoneLabel(generalPrefs.timezone)}
          notificationsEnabledCount={notificationsEnabledCount}
          notificationsTotalCount={3}
          moderationConfigured={moderationConfigured}
        />
        <SettingsSectionNav tabs={tabs} defaultTab="general" />
      </div>
    </WatchShell>
  );
}
