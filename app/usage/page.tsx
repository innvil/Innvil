import Link from "next/link";
import type { Metadata } from "next";
import { LayoutGrid, ShieldCheck, Bot, Users, MessageSquare } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import {
  getAccountCapacity, countRecentModerationActions, listAccountCommunities, listAccountWatchers, getAccountSlotBreakdown,
} from "@/src/lib/products/watch-runtime";
import { getCommunityExpansionState } from "@/src/lib/products/watch-community-expansion";
import { listAvailableDirectWatchGateways } from "@/src/lib/products/watch-checkout";
import { resolveAccountBillingPeriod, getWatchAiResponseUsage, aiResponsePoolLimit } from "@/src/lib/products/watch-ai-usage";
import { reactiveQuotaDay, getCommunityReactiveQuotaUsage } from "@/src/lib/moderator/community-runtime";
import { TRIAL_REACTIVE_DAILY_LIMIT } from "@/src/lib/moderator/plan";
import { trialTimeRemainingLabel } from "@/src/lib/products/watch-trial-format";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { CommunityExpansionCard } from "@/src/components/watch/CommunityExpansionCard";
import { CapacityRow, EmptyRow, SectionHeader, StatCard } from "@/src/components/watch/WatchUI";
import { watchAccessLabel } from "@/src/lib/products/watch-plans";
import { MANAGED_ENTERPRISE_50 } from "@/src/lib/products/watch-enterprise";
import { MODERATOR_COMMUNITY_CAPACITY, type CommunityExpansionEligibleTier, type ModeratorPlanTier } from "@/src/lib/money";

export const metadata: Metadata = { title: "Usage — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function UsagePage() {
  const { accountId, admin } = await requireWatchPage();
  const [capacity, actions7d, actions30d, communities, watchers, breakdown, shell, expansion, gateways, aiPeriod] = await Promise.all([
    getAccountCapacity(admin, accountId),
    countRecentModerationActions(admin, accountId, 7),
    countRecentModerationActions(admin, accountId, 30),
    listAccountCommunities(admin, accountId),
    listAccountWatchers(admin, accountId),
    getAccountSlotBreakdown(admin, accountId),
    getWatchShellContext(admin, accountId),
    getCommunityExpansionState(admin, accountId),
    listAvailableDirectWatchGateways(),
    resolveAccountBillingPeriod(admin, accountId),
  ]);

  const activeWatcherCount = new Set(communities.flatMap((c) => c.watchers.filter((w) => w.enabled).map((w) => w.watcherId))).size;
  const activeDeploymentCount = communities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length;

  // MODERATOR_AI_RESPONSE_POOL (money.ts) -- the one canonical monthly usage
  // limit approved in the Watch plan/entitlement configuration. Only shown
  // for a real paid (non-trial) tier with a resolvable real subscription
  // period -- never fabricated for the trial (which has its own, separate
  // daily reactive quota) or for an account with no trackable period (a
  // legacy never-expiring row predating migration 0080).
  // Managed Enterprise (2026-08-22 repricing) has its own fixed 50,000/mo
  // AI Generation pool (MANAGED_ENTERPRISE_50.aiGenerations) -- read
  // separately from MODERATOR_AI_RESPONSE_POOL's 4 self-serve-tier values,
  // since there is currently no representable BYO Enterprise entitlement
  // row anywhere in this schema (the manual devops grant tool that creates
  // an "enterprise" entitlement has no Managed/BYO distinction), so every
  // `tier === "enterprise"` account today IS de facto Managed -- never
  // fabricated for a real BYO account once one becomes representable.
  const paidTier: ModeratorPlanTier | null = capacity && capacity.tier !== "trial" && capacity.tier !== "enterprise" ? capacity.tier : null;
  const isEnterprise = capacity?.tier === "enterprise";
  const aiUsageLimit = paidTier ? aiResponsePoolLimit(paidTier) : isEnterprise ? MANAGED_ENTERPRISE_50.aiGenerations : null;
  const aiUsageCount = (paidTier || isEnterprise) && aiPeriod ? await getWatchAiResponseUsage(admin, accountId, aiPeriod.start) : null;

  // Trial's own real, measurable current-period consumption: the 20/day
  // reactive-quota counter (moderator/plan.ts TRIAL_REACTIVE_DAILY_LIMIT),
  // scoped per Community and reset per UTC calendar day (community-runtime.ts
  // reactiveQuotaDay -- no per-community timezone field exists yet, see that
  // function's own doc comment). This is a DAILY limit, not monthly -- the
  // trial has no monthly/subscription-period consumption concept at all
  // (MODERATOR_AI_RESPONSE_POOL explicitly excludes trial), so it is shown
  // under its own real "today" period rather than forced into a fabricated
  // monthly bucket. Summed across every Community the account has (the trial
  // is capped at 1, but this generalizes rather than assuming exactly one).
  const isTrial = capacity?.tier === "trial";
  const trialQuotaDay = isTrial ? reactiveQuotaDay(new Date()) : null;
  const trialReactiveUsed =
    isTrial && trialQuotaDay
      ? (await Promise.all(communities.map((c) => getCommunityReactiveQuotaUsage(admin, c.id, trialQuotaDay)))).reduce((a, b) => a + b, 0)
      : null;

  return (
    <WatchShell active="usage" capacity={shell.capacity} attentionCount={shell.attentionCount}>
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
            denominator={capacity ? String(capacity.slotsTotal) : undefined}
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

        {/* ---- Current Period Usage: real metered consumption against a canonical
             limit, distinct from the structural resource capacity below. Paid
             tiers show the one canonical monthly pool (MODERATOR_AI_RESPONSE_POOL);
             the Free Trial shows its own real, separately-scoped DAILY quota
             (TRIAL_REACTIVE_DAILY_LIMIT) -- these are two different real metrics
             with two different real periods, never forced into one fabricated
             shape. Nothing renders here for an account with neither (no active
             plan and no trial), since there is nothing real to meter. ---- */}
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
                  <SectionHeader icon={MessageSquare} title="AI responses (today)" />
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
                <p className="w-display text-lg w-teal mb-1">{watchAccessLabel(capacity.tier)}</p>
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
            active={expansion != null}
            cancelAtPeriodEnd={expansion?.cancelAtPeriodEnd ?? false}
            included={MODERATOR_COMMUNITY_CAPACITY[capacity.tier as CommunityExpansionEligibleTier].included}
            max={MODERATOR_COMMUNITY_CAPACITY[capacity.tier as CommunityExpansionEligibleTier].maxWithAddons}
            used={communities.length}
            availableGateways={gateways}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="w-card p-5">
            <SectionHeader icon={Bot} title="Slots by Watcher" />
            {breakdown.byWatcher.length === 0 ? (
              <EmptyRow text="No active deployments yet." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold pb-2">Watcher</th>
                    <th className="font-semibold pb-2">Deployments</th>
                    <th className="font-semibold pb-2">Slots</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.byWatcher.map((w) => (
                    <tr key={w.watcherId} className="border-t w-line-soft">
                      <td className="py-2"><Link href={`/watchers/${w.watcherId}`} className="w-text hover:w-teal">{w.watcherName}</Link></td>
                      <td className="py-2 w-text-dim">{w.deployments}</td>
                      <td className="py-2 w-text-dim">{w.slots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="w-card p-5">
            <SectionHeader icon={Users} title="Slots by Community" />
            {breakdown.byCommunity.length === 0 ? (
              <EmptyRow text="No active deployments yet." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold pb-2">Community</th>
                    <th className="font-semibold pb-2">Watchers</th>
                    <th className="font-semibold pb-2">Slots</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.byCommunity.map((c) => (
                    <tr key={c.communityId} className="border-t w-line-soft">
                      <td className="py-2"><Link href={`/communities/${c.communityId}`} className="w-text hover:w-teal">{c.communityTitle}</Link></td>
                      <td className="py-2 w-text-dim">{c.deployments}</td>
                      <td className="py-2 w-text-dim">{c.slots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </WatchShell>
  );
}
