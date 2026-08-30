"use client";

import Link from "next/link";
import { LayoutGrid, ShieldCheck, Bot, MessageSquare } from "lucide-react";
import useSWR from "swr";
import { getUsagePageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { ByoUsagePolicyCard } from "./ByoUsagePolicyCard";
import { TRIAL_REACTIVE_DAILY_LIMIT } from "@/src/lib/moderator/plan";
import { trialTimeRemainingLabel } from "@/src/lib/products/watch-trial-format";
import { WatchShell } from "./WatchShell";
import { CommunityExpansionCard } from "./CommunityExpansionCard";
import { CapacityRow, EmptyRow, SectionHeader, StatCard } from "./WatchUI";
import { watchAccessLabel, formatSlotLimit } from "@/src/lib/products/watch-plans";
import { MODERATOR_COMMUNITY_CAPACITY, type CommunityExpansionEligibleTier } from "@/src/lib/money";
import { TableSkeleton } from "./DashboardSkeletons";

/** Cache-first `/usage`. Every value the JSX below reads was already
 *  computed server-side by getUsagePageData -- this component only derives
 *  the two lookup Maps (watcherNameByDeployment/communityTitleById), since
 *  a Map crossing the "use server" boundary would need to survive RSC/flight
 *  serialization for no real benefit when it's this cheap to rebuild from
 *  the already-returned `communities` array. */
export function UsagePageClient() {
  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.usage, getUsagePageData, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) {
    return (
      <WatchShell active="usage" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  if (!data.authenticated) {
    if (typeof window !== "undefined") window.location.href = "/";
    return (
      <WatchShell active="usage" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  const {
    capacity, attentionCount, communities, watchers, actions7d, actions30d, expansionActive, expansionCancelAtPeriodEnd, gateways,
    aiPeriod, aiUsageLimit, aiUsageCount, byoUsage, byoPolicies, mediaUsageCount, enterpriseMediaAllowance, enterpriseMediaUsageCount,
    trialReactiveUsed,
  } = data;

  const activeWatcherCount = new Set(communities.flatMap((c) => c.watchers.filter((w) => w.enabled).map((w) => w.watcherId))).size;
  const activeDeploymentCount = communities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length;
  const watcherNameByDeployment = new Map(communities.flatMap((c) => c.watchers.map((w) => [w.deploymentId, w.watcherName] as const)));
  const communityTitleById = new Map(communities.map((c) => [c.id, c.title ?? c.chatId] as const));
  const isTrial = capacity?.tier === "trial";

  return (
    <WatchShell active="usage" capacity={capacity} attentionCount={attentionCount}>
      <div className="space-y-6">
        <div>
          <h1 className="w-display text-xl mb-1">Usage</h1>
          <p className="text-sm w-text-dim">What's actually being consumed, and by what.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Watcher profiles" value={watchers.length} note="reusable identities" />
          <StatCard
            label="Watcher slots"
            value={activeDeploymentCount}
            denominator={capacity ? formatSlotLimit(capacity.slotsTotal) : undefined}
            note={`${activeWatcherCount} unique Watcher${activeWatcherCount === 1 ? "" : "s"} deployed`}
          />
          <StatCard label="Communities" value={communities.length} denominator={capacity ? String(capacity.communitiesTotal) : undefined} />
          <StatCard label="Moderation actions" value={actions7d} note="last 7 days" />
        </div>

        {!capacity && (
          <div className="w-card p-4 border w-amber-border text-sm w-text-dim">
            No active subscription — the numbers above are real, but nothing is currently entitled to run.{" "}
            <Link href="/plans" className="w-teal hover:underline">Choose a plan</Link>.
          </div>
        )}

        {((aiUsageLimit != null && aiUsageCount != null && aiPeriod) || (isTrial && trialReactiveUsed != null)) && (
          <div>
            <h2 className="w-display text-sm w-text-dim mb-2">Current Period Usage</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {aiUsageLimit != null && aiUsageCount != null && aiPeriod && (
                <div className="w-card p-5">
                  <SectionHeader icon={MessageSquare} title="AI Generations" />
                  <div className="flex items-end justify-between gap-3 mb-2">
                    <p className="w-display text-2xl w-text">
                      {aiUsageCount.toLocaleString()} <span className="text-sm w-text-faint font-normal">/ {aiUsageLimit.toLocaleString()} this period</span>
                    </p>
                  </div>
                  <div className="h-1.5 rounded-full w-surface-raised overflow-hidden mb-2">
                    <div
                      className="h-full w-teal-bg rounded-full"
                      style={{ width: `${Math.min(100, (aiUsageCount / Math.max(1, aiUsageLimit)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs w-text-faint">
                    Current period {new Date(aiPeriod.start).toLocaleDateString()} – {new Date(aiPeriod.end).toLocaleDateString()}. Counts
                    conversational replies your Watchers generate (not silence, reactions, or moderation actions) — a pooled allowance
                    shared across every Watcher on this account, read-only and set by your plan.
                  </p>
                </div>
              )}

              {isTrial && trialReactiveUsed != null && (
                <div className="w-card p-5">
                  <SectionHeader icon={MessageSquare} title="AI Generations (today)" />
                  <div className="flex items-end justify-between gap-3 mb-2">
                    <p className="w-display text-2xl w-text">
                      {trialReactiveUsed.toLocaleString()} <span className="text-sm w-text-faint font-normal">/ {TRIAL_REACTIVE_DAILY_LIMIT.toLocaleString()} today</span>
                    </p>
                  </div>
                  <div className="h-1.5 rounded-full w-surface-raised overflow-hidden mb-2">
                    <div
                      className="h-full w-teal-bg rounded-full"
                      style={{ width: `${Math.min(100, (trialReactiveUsed / Math.max(1, TRIAL_REACTIVE_DAILY_LIMIT)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs w-text-faint">
                    Resets daily (UTC). Counts conversational replies your Watcher generates during the Free Trial — a per-Community
                    daily allowance, separate from the monthly pool paid plans use.
                  </p>
                </div>
              )}

              {isTrial && capacity?.trialEndsAt && (
                <div className="w-card p-5">
                  <SectionHeader icon={ShieldCheck} title="Free Trial period" />
                  <p className="w-display text-lg w-teal mb-1">{trialTimeRemainingLabel(capacity.trialEndsAt)}</p>
                  <p className="text-xs w-text-faint">
                    {capacity.trialStartedAt ? new Date(capacity.trialStartedAt).toLocaleDateString() : "—"} – {new Date(capacity.trialEndsAt).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="w-card p-5">
            <SectionHeader icon={ShieldCheck} title="Plan capacity" />
            {capacity ? (
              <>
                <p className="w-display text-lg w-teal mb-1">{watchAccessLabel(capacity.tier, { apiSourceMode: capacity.apiSourceMode ?? "managed", slots: capacity.enterpriseSlots })}</p>
                {capacity.tier !== "trial" && capacity.paidThrough && (
                  <p className="text-xs w-text-faint mb-3">Paid through {new Date(capacity.paidThrough).toLocaleDateString()}</p>
                )}
                {!(capacity.tier !== "trial" && capacity.paidThrough) && <div className="mb-3" />}
                <div className="space-y-3">
                  <CapacityRow label="Watcher slots" used={capacity.activeDeploymentCount} total={capacity.slotsTotal} />
                  <CapacityRow label="Communities" used={capacity.communitiesUsed} total={capacity.communitiesTotal} />
                </div>
              </>
            ) : (
              <EmptyRow text="No active plan found." />
            )}
          </div>
          <div className="w-card p-5">
            <SectionHeader icon={LayoutGrid} title="Moderation activity" />
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span className="w-text-dim">Last 7 days</span><span className="w-text font-medium">{actions7d}</span></div>
              <div className="flex items-center justify-between"><span className="w-text-dim">Last 30 days</span><span className="w-text font-medium">{actions30d}</span></div>
            </div>
            <p className="text-xs w-text-faint mt-4">Counts real warn/kick/ban decisions made by your Watchers — not routine chatter or silence.</p>
          </div>
        </div>

        {capacity && capacity.communityExpansionEligible && (
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

        {capacity?.mediaModerationAddonActive && capacity.mediaModerationUnitAllowance != null && (
          <div className="w-card p-5">
            <SectionHeader icon={ShieldCheck} title="Media Moderation +" />
            <p className="text-sm w-text-dim mb-1">
              {(mediaUsageCount ?? 0).toLocaleString()} / {capacity.mediaModerationUnitAllowance.toLocaleString()} Media Moderation Units used this period.
            </p>
            <div className="w-full h-1.5 rounded-full w-surface-raised overflow-hidden mb-2">
              <div
                className="h-full w-teal-bg"
                style={{ width: `${Math.min(100, ((mediaUsageCount ?? 0) / capacity.mediaModerationUnitAllowance) * 100)}%` }}
              />
            </div>
            <Link href="/plans#paid-plans" className="w-teal hover:underline text-xs font-medium">Manage from Plans →</Link>
          </div>
        )}

        {capacity?.tier === "enterprise" && (
          <div className="w-card p-5">
            <SectionHeader icon={ShieldCheck} title="Media Moderation +" />
            {capacity.enterpriseMediaAddonActive && enterpriseMediaAllowance != null ? (
              <>
                <p className="text-sm w-text-dim mb-1">
                  {(enterpriseMediaUsageCount ?? 0).toLocaleString()} / {enterpriseMediaAllowance.toLocaleString()} Media Moderation Units used this period.
                </p>
                <div className="w-full h-1.5 rounded-full w-surface-raised overflow-hidden">
                  <div
                    className="h-full w-teal-bg"
                    style={{ width: `${Math.min(100, ((enterpriseMediaUsageCount ?? 0) / enterpriseMediaAllowance) * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm w-text-faint">Not added — contact support to add Media Moderation + to your Enterprise plan.</p>
            )}
          </div>
        )}

        {capacity?.apiSourceMode === "byo" && byoUsage && (
          <div className="w-card p-5">
            <SectionHeader icon={Bot} title="BYO calls (last 30 days)" />
            <p className="text-xs w-text-faint -mt-2 mb-3">
              Real, observed calls made through your own stored AI provider credential.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="w-display text-xl w-text">{byoUsage.totalCalls.toLocaleString()}</p>
                <p className="text-[11px] w-text-faint">Total calls</p>
              </div>
              <div>
                <p className="w-display text-xl w-green">{byoUsage.successfulCalls.toLocaleString()}</p>
                <p className="text-[11px] w-text-faint">Successful</p>
              </div>
              <div>
                <p className="w-display text-xl w-amber">{byoUsage.failedCalls.toLocaleString()}</p>
                <p className="text-[11px] w-text-faint">Failed</p>
              </div>
            </div>
            {(byoUsage.totalInputTokens != null || byoUsage.totalOutputTokens != null || byoUsage.avgDurationMs != null) && (
              <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b w-line-soft">
                {byoUsage.totalInputTokens != null && (
                  <div>
                    <p className="w-display text-lg w-text">{byoUsage.totalInputTokens.toLocaleString()}</p>
                    <p className="text-[11px] w-text-faint">Input tokens</p>
                  </div>
                )}
                {byoUsage.totalOutputTokens != null && (
                  <div>
                    <p className="w-display text-lg w-text">{byoUsage.totalOutputTokens.toLocaleString()}</p>
                    <p className="text-[11px] w-text-faint">Output tokens</p>
                  </div>
                )}
                {byoUsage.avgDurationMs != null && (
                  <div>
                    <p className="w-display text-lg w-text">{byoUsage.avgDurationMs.toLocaleString()}ms</p>
                    <p className="text-[11px] w-text-faint">Avg. call duration</p>
                  </div>
                )}
              </div>
            )}
            {byoUsage.byAutomation.length > 0 ? (
              <div className="space-y-1.5">
                {byoUsage.byAutomation.map((a) => (
                  <div key={a.automation} className="flex items-center justify-between text-xs">
                    <span className="w-text-dim">{a.automation}</span>
                    <span className="w-text-faint">{a.successful}/{a.total} succeeded</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs w-text-faint">No calls recorded yet.</p>
            )}
            {byoUsage.byDeployment.length > 0 && (
              <div className="mt-3 pt-3 border-t w-line-soft space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide w-text-faint font-semibold mb-1">By Watcher</p>
                {byoUsage.byDeployment.map((d) => (
                  <div key={d.deploymentId} className="flex items-center justify-between text-xs">
                    <span className="w-text-dim">{watcherNameByDeployment.get(d.deploymentId) ?? "Deleted Watcher"}</span>
                    <span className="w-text-faint">{d.successful}/{d.total} succeeded</span>
                  </div>
                ))}
              </div>
            )}
            {byoUsage.byCommunity.length > 1 && (
              <div className="mt-3 pt-3 border-t w-line-soft space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide w-text-faint font-semibold mb-1">By Community</p>
                {byoUsage.byCommunity.map((c) => (
                  <div key={c.communityId} className="flex items-center justify-between text-xs">
                    <span className="w-text-dim">{communityTitleById.get(c.communityId) ?? "Deleted Community"}</span>
                    <span className="w-text-faint">{c.successful}/{c.total} succeeded</span>
                  </div>
                ))}
              </div>
            )}
            {!capacity.hasByoCredential && (
              <p className="text-xs w-amber mt-3">
                No AI provider credential is currently stored for this account — every call will fail until one is configured.
              </p>
            )}
          </div>
        )}

        {capacity?.apiSourceMode === "byo" && byoPolicies && (
          <ByoUsagePolicyCard
            initial={byoPolicies}
            communities={communities.map((c) => ({ id: c.id, title: c.title ?? c.chatId }))}
            deployments={communities.flatMap((c) =>
              c.watchers.map((w) => ({ deploymentId: w.deploymentId, watcherName: w.watcherName, communityTitle: c.title ?? c.chatId }))
            )}
          />
        )}

        <Link href="/deployments" className="w-card p-4 flex items-center justify-between gap-3 hover:w-teal-border">
          <div>
            <p className="w-text text-sm font-medium">See what's actually consuming your Watcher slots</p>
            <p className="text-xs w-text-faint mt-0.5">Real per-Watcher / per-Community deployment breakdown, in Operations → Deployments.</p>
          </div>
          <span className="text-xs w-teal shrink-0">Open Deployments →</span>
        </Link>
      </div>
    </WatchShell>
  );
}
