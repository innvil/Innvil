"use client";

import { User, Link2 } from "lucide-react";
import useSWR from "swr";
import { getProfilePageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { WatchShell } from "./WatchShell";
import { SectionHeader } from "./WatchUI";
import { ConnectTelegramCard } from "./ConnectTelegramCard";
import { TableSkeleton } from "./DashboardSkeletons";

/** Cache-first `/profile`. */
export function ProfilePageClient() {
  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.profile, getProfilePageData, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) {
    return (
      <WatchShell active="profile" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  if (!data.authenticated || !data.preferences) {
    if (typeof window !== "undefined" && !data.authenticated) window.location.href = "/";
    return (
      <WatchShell active="profile" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  const { capacity, attentionCount, email, telegramState, preferences } = data;

  return (
    <WatchShell active="profile" capacity={capacity} attentionCount={attentionCount}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="w-display text-xl mb-1">Profile</h1>
          <p className="text-sm w-text-dim">Manage your Innvil account identity and connected accounts.</p>
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

        <div id="connected-identities" className="w-card p-5 scroll-mt-24">
          <SectionHeader icon={Link2} title="Connected identities" />
          <ConnectTelegramCard initial={telegramState} preferences={preferences} />
        </div>
      </div>
    </WatchShell>
  );
}
