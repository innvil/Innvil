import Link from "next/link";
import type { Metadata } from "next";
import { Layers, Bot, Users, HelpCircle } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountSlotBreakdown } from "@/src/lib/products/watch-runtime";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { EmptyRow, SectionHeader, StatCard } from "@/src/components/watch/WatchUI";
import { formatSlotLimit } from "@/src/lib/products/watch-plans";

export const metadata: Metadata = { title: "Deployments — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

/**
 * Operations -> Deployments: the real operational surface for "what is
 * deployed, where, and why does it consume slots" -- distinct from Billing
 * (entitlement/purchasing) and Usage (consumption/limits). A Deployment is a
 * genuine relationship record between a Watcher and a Community, so it gets
 * its own operational page instead of being scattered across Watcher
 * detail, Community detail, Usage, and Billing.
 *
 * Built entirely from data that already exists (listAccountCommunities's
 * per-Community `watchers` array already carries every deployment, enabled
 * or paused; getAccountSlotBreakdown groups the SAME data by Watcher/
 * Community) -- no new query shape, no new table, no fabricated numbers.
 */
export default async function DeploymentsPage() {
  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);
  const { capacity, communities, watchers } = shell;
  const breakdown = await getAccountSlotBreakdown(admin, accountId, communities);

  const activeDeploymentCount = communities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length;
  const communitiesWithDeployments = communities.filter((c) => c.watchers.length > 0).length;

  // Every real deployment row, active or paused -- the flat operational
  // truth table. One row per (Watcher, Community) relationship.
  const rows = communities.flatMap((c) =>
    c.watchers.map((w) => ({
      deploymentId: w.deploymentId,
      watcherId: w.watcherId,
      watcherName: w.watcherName,
      communityId: c.id,
      communityTitle: c.title ?? c.chatId,
      enabled: w.enabled,
    }))
  );

  return (
    <WatchShell active="deployments" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6">
        <div>
          <h1 className="w-display text-xl mb-1">Deployments</h1>
          <p className="text-sm w-text-dim">What's actually deployed, where, and why it's consuming your Watcher slots.</p>
        </div>

        {/* Compact capacity summary -- billing tells you what you're
            allowed to have; this tells you what's actually consuming it. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Watcher slots used"
            value={capacity ? capacity.activeDeploymentCount : activeDeploymentCount}
            denominator={capacity ? formatSlotLimit(capacity.slotsTotal) : undefined}
          />
          <StatCard label="Watcher profiles" value={watchers.length} />
          <StatCard label="Active deployments" value={activeDeploymentCount} />
          <StatCard label="Communities" value={communitiesWithDeployments} />
        </div>

        {/* The three concepts, prominent -- so a customer never has to
            infer the model from the table alone. */}
        <div className="w-card p-5">
          <SectionHeader icon={Layers} title="How this works" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="w-teal font-medium mb-1">Watcher Profile</p>
              <p className="w-text-dim text-xs leading-relaxed">The reusable AI moderator identity/persona — created once, deployable to any Community.</p>
            </div>
            <div>
              <p className="w-teal font-medium mb-1">Active Deployment</p>
              <p className="w-text-dim text-xs leading-relaxed">A Watcher currently assigned and enabled in one specific Community.</p>
            </div>
            <div>
              <p className="w-teal font-medium mb-1">Watcher Slot</p>
              <p className="w-text-dim text-xs leading-relaxed">The capacity one active deployment consumes. One Watcher deployed to two Communities uses two slots.</p>
            </div>
          </div>

          {breakdown.byWatcher.length > 0 && (
            <details className="mt-4 group">
              <summary className="text-xs w-teal hover:underline cursor-pointer inline-flex items-center gap-1.5">
                <HelpCircle size={13} /> How slots work, using your own deployments
              </summary>
              <div className="mt-3 space-y-3 text-xs">
                {breakdown.byWatcher.map((w) => {
                  const deploymentsForWatcher = rows.filter((r) => r.watcherId === w.watcherId && r.enabled);
                  return (
                    <div key={w.watcherId} className="border-l-2 w-teal-border pl-3">
                      {deploymentsForWatcher.map((d, i) => (
                        <p key={d.deploymentId} className="w-text-dim">
                          <Link href={`/watchers/${w.watcherId}`} className="w-text hover:w-teal">{w.watcherName}</Link>
                          {" → "}
                          <Link href={`/communities/${d.communityId}`} className="w-text hover:w-teal">{d.communityTitle}</Link>
                          {" = "}{i === 0 ? "1 slot" : "1 additional slot"}
                        </p>
                      ))}
                      <p className="w-text-faint mt-1">
                        1 Watcher Profile + {w.deployments} active deployment{w.deployments === 1 ? "" : "s"} = {w.slots} Watcher slot{w.slots === 1 ? "" : "s"}
                      </p>
                    </div>
                  );
                })}
                <Link href="/support/watchers/watcher-profiles-deployments-slots" className="w-teal hover:underline inline-block">
                  Read the full explanation in the Help Center →
                </Link>
              </div>
            </details>
          )}
        </div>

        {/* The real operational truth: every deployment row. */}
        <div className="w-card p-0 overflow-hidden">
          <div className="p-5 pb-0"><SectionHeader icon={Bot} title="All deployments" /></div>
          {rows.length === 0 ? (
            <div className="pb-6"><EmptyRow text="No Watchers deployed to any Community yet." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold py-3 px-5">Watcher</th>
                    <th className="font-semibold py-3 px-4"><Users size={11} className="inline -mt-0.5 mr-1" />Community</th>
                    <th className="font-semibold py-3 px-4">Status</th>
                    <th className="font-semibold py-3 px-5 text-right">Slot usage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.deploymentId} className="border-t w-line-soft">
                      <td className="py-2.5 px-5"><Link href={`/watchers/${r.watcherId}`} className="w-text hover:w-teal flex items-center gap-2"><Bot size={13} className="w-teal shrink-0" /> {r.watcherName}</Link></td>
                      <td className="py-2.5 px-4"><Link href={`/communities/${r.communityId}`} className="w-text-dim hover:w-teal">{r.communityTitle}</Link></td>
                      <td className="py-2.5 px-4">{r.enabled ? <span className="text-xs w-green">Active</span> : <span className="text-xs w-text-faint">Paused</span>}</td>
                      <td className="py-2.5 px-5 text-right w-text-dim">{r.enabled ? "1 slot" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </WatchShell>
  );
}
