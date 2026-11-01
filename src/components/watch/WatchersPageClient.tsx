"use client";

import useSWR from "swr";
import { getWatchersPageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { deploymentSummaries } from "@/src/lib/products/watch-status";
import { WatchShell } from "./WatchShell";
import { WatchersWorkspaceClient } from "./WatchersWorkspaceClient";
import { TableSkeleton } from "./DashboardSkeletons";

/** Cache-first `/watchers` (no Watcher selected) -- same pattern as
 *  OverviewClient: `getWatchersPageData` (an existing-shape "use server"
 *  action, reusing the already-optimized watch-runtime.ts functions) is the
 *  SWR fetcher, keyed by WATCH_SWR_KEYS.watchers so mutations elsewhere
 *  (create/connect a Watcher) can revalidate this exact entry. A skeleton
 *  only shows on a genuinely empty cache (first visit this session); every
 *  later visit renders instantly from the cache while revalidating quietly. */
export function WatchersPageClient() {
  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.watchers, getWatchersPageData, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) {
    return (
      <WatchShell active="watchers" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  return (
    <WatchShell active="watchers" capacity={data.capacity} attentionCount={data.attentionCount}>
      <WatchersWorkspaceClient
        watchers={data.watchers}
        deployments={deploymentSummaries(data.communities)}
        projects={data.projects}
        selectedId={null}
        detail={null}
      />
    </WatchShell>
  );
}
