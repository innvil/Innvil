"use client";

import useSWR from "swr";
import { getWatchAccessState } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { WatchDashboard } from "./WatchDashboard";
import { OverviewSkeleton } from "./DashboardSkeletons";

/**
 * Cache-first / stale-while-revalidate Overview.
 *
 * `getWatchAccessState` (an existing "use server" action, unchanged) is used
 * directly as the SWR fetcher -- Server Actions are callable from Client
 * Components as ordinary async functions, so no new server-side plumbing was
 * needed. SWR's default `revalidateIfStale: true` means: first visit in a
 * session -> no cache yet -> `isLoading` -> render the skeleton while the
 * real fetch runs; every later navigation back to Overview in the SAME
 * session -> SWR's cache (a module-level singleton that survives Next.js
 * App Router client-side navigations) already has data -> renders instantly
 * from it -> a background revalidation still runs and silently updates the
 * view once it resolves. No full-page spinner either way.
 */
export function OverviewClient() {
  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.overview, getWatchAccessState, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) return <OverviewSkeleton />;

  // A genuinely unauthenticated response (session expired mid-visit) is the
  // one case this cache-first page must still handle honestly -- never
  // render a dashboard shell with no real data behind it.
  if (!data.authenticated) {
    if (typeof window !== "undefined") window.location.href = "/";
    return <OverviewSkeleton />;
  }

  return (
    <WatchDashboard
      projects={data.projects}
      watchers={data.watchers}
      communities={data.communities}
      capacity={data.capacity}
      activity={data.activity}
      moderationActionsLast7Days={data.moderationActionsLast7Days}
      attentionItems={data.attentionItems}
      communityStats={data.communityStats}
      telegramVerified={data.telegramVerified}
      trialStatus={data.trialStatus}
      onboardingStage={data.onboardingStage}
    />
  );
}
