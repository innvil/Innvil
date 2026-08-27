"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import useSWR from "swr";
import { getCommunitiesPageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { communityOperationalStatus, type CommunityOperationalStatus } from "@/src/lib/products/watch-status";
import { MODERATOR_COMMUNITY_CAPACITY, type CommunityExpansionEligibleTier } from "@/src/lib/money";
import { WatchShell } from "./WatchShell";
import { CommunityExpansionCard } from "./CommunityExpansionCard";
import { EmptyRow, OperationalStatusBadge, CapacityRow, relTime, WatcherNamesCell } from "./WatchUI";
import { TableSkeleton } from "./DashboardSkeletons";

const STATUS_FILTERS: Array<{ value: CommunityOperationalStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "healthy", label: "Healthy" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "paused", label: "Paused" },
];

/** Cache-first `/communities` -- same pattern as WatchersPageClient/
 *  OverviewClient. The `status` filter reads directly from the URL (via
 *  `useSearchParams`, a client-side read) instead of a Server Component
 *  `searchParams` prop, since this page no longer does any server-side data
 *  fetch of its own to thread that value through. */
export function CommunitiesPageClient() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "";

  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.communities, getCommunitiesPageData, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) {
    return (
      <WatchShell active="communities" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  const { communities, capacity, communityStats, expansionActive, expansionCancelAtPeriodEnd, gateways } = data;
  const filtered = status ? communities.filter((c) => communityOperationalStatus(c) === status) : communities;

  return (
    <WatchShell active="communities" capacity={capacity} attentionCount={data.attentionCount}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="w-display text-xl mb-1">Communities</h1>
            <p className="text-sm w-text-dim">Every Telegram community connected across your Projects.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.value || "all"}
                href={f.value ? `/communities?status=${f.value}` : "/communities"}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${status === f.value ? "w-teal-border w-teal" : "w-line-soft w-text-dim hover:w-text"}`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>

        {/* ---- Community capacity / Community Expansion: the operational discovery +
             management surface for this add-on (Plans stays the explanation/comparison
             page, Billing stays payment/history). Plain capacity is shown for every
             tier (a genuine hard cap for Bronze/Silver/Trial -- no purchase path).
             The full purchase/manage card only renders for a Gold/Platinum tier
             (capacity.communityExpansionEligible is structurally false for Trial/
             Bronze/Silver/Enterprise -- Enterprise isn't even a ModeratorPlanTier
             value), and is the EXACT SAME component/actions Usage already uses --
             no second pricing/purchase/manage implementation. ---- */}
        {capacity && (
          <div className={capacity.communityExpansionEligible ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : undefined}>
            <div className="w-card p-5">
              <p className="text-xs uppercase tracking-wide w-text-faint font-semibold mb-3">Community capacity</p>
              <CapacityRow label="Communities" used={capacity.communitiesUsed} total={capacity.communitiesTotal} />
            </div>
            {capacity.communityExpansionEligible && (
              <CommunityExpansionCard
                tier={capacity.tier as CommunityExpansionEligibleTier}
                billingInterval={capacity.billingInterval}
                active={expansionActive}
                cancelAtPeriodEnd={expansionCancelAtPeriodEnd}
                included={MODERATOR_COMMUNITY_CAPACITY[capacity.tier as CommunityExpansionEligibleTier].included}
                max={MODERATOR_COMMUNITY_CAPACITY[capacity.tier as CommunityExpansionEligibleTier].maxWithAddons}
                used={communities.length}
                availableGateways={gateways}
              />
            )}
          </div>
        )}

        {communities.length === 0 ? (
          <div className="w-card p-10 text-center">
            <Users size={28} className="w-teal mx-auto mb-3" />
            <EmptyRow text="No Communities connected yet." />
            <p className="text-xs w-text-faint">
              Connect one from a deployable Watcher on the{" "}
              <Link href="/watchers" className="w-teal hover:underline">Watchers page</Link>.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="w-card p-10 text-center"><EmptyRow text="No Communities match this filter." /></div>
        ) : (
          <div className="w-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold py-3 px-4">Community</th>
                    <th className="font-semibold py-3 px-4">Project</th>
                    <th className="font-semibold py-3 px-4">Platform</th>
                    <th className="font-semibold py-3 px-4">Health</th>
                    <th className="font-semibold py-3 px-4">Watchers</th>
                    <th className="font-semibold py-3 px-4">Last activity</th>
                    <th className="font-semibold py-3 px-4">Moderation (24h)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const stats = communityStats[c.id];
                    return (
                      <tr key={c.id} className="border-t w-line-soft">
                        <td className="py-3 px-4"><Link href={`/communities/${c.id}`} className="w-text hover:w-teal font-medium">{c.title ?? c.chatId}</Link></td>
                        <td className="py-3 px-4"><Link href={`/projects/${c.projectId}`} className="w-text-dim hover:w-text">{c.projectName}</Link></td>
                        <td className="py-3 px-4 w-text-dim capitalize">{c.platform}</td>
                        <td className="py-3 px-4">
                          {c.connectionType === "escalation_group" ? (
                            <span className="text-[11px] font-semibold uppercase tracking-wide w-text-faint">Escalation Group</span>
                          ) : (
                            <OperationalStatusBadge status={communityOperationalStatus(c)} />
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs"><WatcherNamesCell watchers={c.watchers} /></td>
                        <td className="py-3 px-4 w-text-dim">{stats?.lastActivityAt ? relTime(stats.lastActivityAt) : "—"}</td>
                        <td className="py-3 px-4 w-text-dim">{stats?.moderationCount24h ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </WatchShell>
  );
}
