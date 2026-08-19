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
import { WatchShell } from "@/src/components/watch/WatchShell";
import { CommunityExpansionCard } from "@/src/components/watch/CommunityExpansionCard";
import { CapacityRow, EmptyRow, SectionHeader, StatCard } from "@/src/components/watch/WatchUI";
import { watchAccessLabel } from "@/src/lib/products/watch-plans";
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
  const paidTier: ModeratorPlanTier | null = capacity && capacity.tier !== "trial" ? capacity.tier : null;
  const aiUsageCount = paidTier && aiPeriod ? await getWatchAiResponseUsage(admin, accountId, aiPeriod.start) : null;

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

        {paidTier && aiUsageCount != null && aiPeriod && (
          <div className="w-card p-5">
            <SectionHeader icon={MessageSquare} title="AI responses" />
            <div className="flex items-end justify-between gap-3 mb-2">
              <p className="w-display text-2xl w-text">
                {aiUsageCount.toLocaleString()} <span className="text-sm w-text-faint font-normal">/ {aiResponsePoolLimit(paidTier).toLocaleString()} this period</span>
              </p>
            </div>
            <div className="h-1.5 rounded-full w-surface-raised overflow-hidden mb-2">
              <div
                className="h-full w-teal-bg rounded-full"
                style={{ width: `${Math.min(100, (aiUsageCount / Math.max(1, aiResponsePoolLimit(paidTier))) * 100)}%` }}
              />
            </div>
            <p className="text-xs w-text-faint">
              Current period {new Date(aiPeriod.start).toLocaleDateString()} – {new Date(aiPeriod.end).toLocaleDateString()}. Counts
              conversational replies your Watchers generate (not silence, reactions, or moderation actions) — a pooled allowance
              shared across every Watcher on this account, read-only and set by your plan.
            </p>
          </div>
        )}

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
