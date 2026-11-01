"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Radio, TrendingUp } from "lucide-react";
import useSWR from "swr";
import { getActivityPageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import type { AccountActivityItem } from "@/src/lib/products/watch-runtime";
import { WatchShell } from "./WatchShell";
import { relTime, EmptyRow, SectionHeader } from "./WatchUI";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityTrendChart } from "./ActivityTrendChart";
import { TableSkeleton } from "./DashboardSkeletons";

function groupByDay(items: AccountActivityItem[]): Array<{ label: string; items: AccountActivityItem[] }> {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  const groups = new Map<string, AccountActivityItem[]>();
  for (const item of items) {
    const day = new Date(item.createdAt).toDateString();
    const label = day === today ? "Today" : day === yesterday ? "Yesterday" : "Earlier";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }
  return ["Today", "Yesterday", "Earlier"].filter((l) => groups.has(l)).map((l) => ({ label: l, items: groups.get(l)! }));
}

/** Cache-first `/activity` -- the community/watcher/days filter is read from
 *  the URL client-side (`useSearchParams`) and folded into the SWR key as an
 *  array, so each distinct filter combination gets its own cache entry
 *  (SWR calls the fetcher with every array element as a positional
 *  argument) rather than one shared, ever-changing key. */
export function ActivityPageClient() {
  const searchParams = useSearchParams();
  const communityId = searchParams.get("community") ?? "";
  const watcherId = searchParams.get("watcher") ?? "";
  const days = searchParams.get("days") ?? "30";

  const { data, isLoading } = useSWR(
    [WATCH_SWR_KEYS.activity, communityId, watcherId, days],
    getActivityPageData,
    { revalidateOnFocus: true },
  );

  if (isLoading || !data) {
    return (
      <WatchShell active="activity" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  if (!data.authenticated) {
    if (typeof window !== "undefined") window.location.href = "/";
    return (
      <WatchShell active="activity" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  const { communities, watchers, activity, trend, capacity, attentionCount } = data;
  const groups = groupByDay(activity);
  const trendTotal = trend.reduce((s, p) => s + p.count, 0);
  const warnings = activity.filter((a) => /warned/.test(a.description)).length;
  const removals = activity.filter((a) => /removed/.test(a.description)).length;

  return (
    <WatchShell active="activity" capacity={capacity} attentionCount={attentionCount}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="w-display text-xl mb-1">Activity</h1>
            <p className="text-sm w-text-dim">Real moderation actions taken across your Communities.</p>
          </div>
          <ActivityFilters communities={communities} watchers={watchers} />
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={TrendingUp} title="Activity over time" />
          <ActivityTrendChart points={trend} />
        </div>

        {trendTotal > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Total actions</p>
              <p className="w-display text-lg w-text">{trendTotal}</p>
            </div>
            {warnings > 0 && (
              <div className="w-card p-4">
                <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Warnings</p>
                <p className="w-display text-lg w-text">{warnings}</p>
              </div>
            )}
            {removals > 0 && (
              <div className="w-card p-4">
                <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Removals</p>
                <p className="w-display text-lg w-text">{removals}</p>
              </div>
            )}
          </div>
        )}

        <div className="w-card p-5">
          {activity.length === 0 ? (
            <div className="text-center py-10">
              <Radio size={24} className="w-teal mx-auto mb-3" />
              <EmptyRow text="No activity to show for this filter yet." />
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2.5">{group.label}</p>
                  <ul className="space-y-4">
                    {group.items.map((item) => (
                      <li key={item.id} className="flex items-start gap-3 border-b w-line-soft pb-4 last:border-0 last:pb-0">
                        <Radio size={14} className="w-teal shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm w-text leading-snug">
                            {item.watcherId ? (
                              <Link href={`/watchers/${item.watcherId}`} className="font-medium hover:w-teal">{item.watcherName}</Link>
                            ) : (
                              <span className="font-medium">{item.watcherName ?? "A Watcher"}</span>
                            )}{" "}
                            {item.description}
                          </p>
                          <p className="text-xs w-text-faint mt-0.5">
                            <Link href={`/communities/${item.communityId}`} className="hover:w-text-dim">{item.communityTitle}</Link> · {relTime(item.createdAt)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WatchShell>
  );
}
