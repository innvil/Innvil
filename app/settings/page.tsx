import type { Metadata } from "next";
import { Bell, Settings as SettingsIcon, Lock, KeyRound } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getNotificationPreferences } from "@/src/lib/products/watch-notifications";
import { getAccountPreferences } from "@/src/lib/products/watch-account-preferences";
import { timezoneLabel } from "@/src/lib/products/watch-datetime";
import { getAccountCapacity } from "@/src/lib/products/watch-runtime";
import { getWatchByoCredentialState } from "@/src/lib/actions/watch-byo-settings";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { SettingsSectionNav } from "@/src/components/watch/SettingsSectionNav";
import { SettingsSummary } from "@/src/components/watch/SettingsSummary";
import type { WatchTab } from "@/src/components/watch/WatchTabs";
import { NotificationsSettingsCard } from "@/src/components/watch/NotificationsSettingsCard";
import { GeneralSettingsCard } from "@/src/components/watch/GeneralSettingsCard";
import { SecuritySettingsCard } from "@/src/components/watch/SecuritySettingsCard";
import { ByoCredentialSettingsCard } from "@/src/components/watch/ByoCredentialSettingsCard";

export const metadata: Metadata = { title: "Settings — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

// Settings = "how Watch behaves" only. Profile ("who you are") and Support
// ("how you get help") stay OUT of here -- Profile has its own sidebar
// entry, Support is its own /support route reachable via the sidebar's
// "Need help?" link. Sections shown are only ones backed by real
// functionality: General (timezone/time format, migration 0076),
// Notifications (three real categories mapped onto listAccountAttentionItems's
// own severity partition, migration 0078), and Security (Change Password +
// real email-verification/sign-in-method state, zero new backend beyond the
// existing actions/account.ts). No "Telegram" section exists yet --
// investigated, no real account-level Telegram BEHAVIOR configuration
// exists today (bot_ack_mode is per-Community only).
//
// Moderation Defaults was removed per explicit product decision (2026-08-19)
// -- moderation persona is now always an explicit per-Watcher assignment
// (see watch-runtime.ts's createAccountWatcher / the Watcher detail page's
// Persona tab), never a silently-applied account-wide default, so the
// "Default for new Watchers" concept this section existed to configure no
// longer applies to anything. The old table (`watch_moderation_defaults`) is
// left in place, unread by any code path -- not dropped in this pass.
//
// AI Provider (BYO Enterprise, Phase 2, 2026-08-24; widened 2026-08-25 for
// the self-serve BYO 20 tier) is the newest real section -- shown for an
// account whose real, current Enterprise entitlement is explicitly flagged
// apiSourceMode === "byo", OR whose tier is "byo20" (BYO by tier
// definition). Never a client-side/UI-only gate; the underlying actions
// re-verify this server-side themselves regardless of whether this tab is
// even rendered.
export default async function SettingsPage() {
  const { accountId, admin } = await requireWatchPage();
  const [shell, notificationPrefs, generalPrefs, userRes, capacity] = await Promise.all([
    getWatchShellContext(admin, accountId),
    getNotificationPreferences(admin, accountId),
    getAccountPreferences(admin, accountId),
    admin.auth.admin.getUserById(accountId),
    getAccountCapacity(admin, accountId),
  ]);

  const notificationsEnabledCount = [
    notificationPrefs.noActiveWatcherEnabled, notificationPrefs.capacityWarningEnabled, notificationPrefs.watcherStatusEnabled,
  ].filter(Boolean).length;
  const emailVerified = Boolean(userRes.data.user?.email_confirmed_at);
  const isByoAccount = (capacity?.tier === "enterprise" && capacity.apiSourceMode === "byo") || capacity?.tier === "byo20";
  const byoCredentialState = isByoAccount ? await getWatchByoCredentialState() : null;

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

  if (isByoAccount && byoCredentialState?.ok) {
    tabs.push({
      id: "ai-provider",
      label: "AI Provider",
      content: (
        <div className="w-card p-5">
          <SectionHeader icon={KeyRound} title="AI Provider" />
          <p className="text-xs w-text-faint -mt-2 mb-4">
            Your plan runs on your own AI provider credential — manage it here instead of contacting support.
          </p>
          <ByoCredentialSettingsCard initial={byoCredentialState.data} />
        </div>
      ),
    });
  }

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
        />
        <SettingsSectionNav tabs={tabs} defaultTab="general" />
      </div>
    </WatchShell>
  );
}
