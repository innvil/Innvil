"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Plus, FolderKanban, Bot, Users, ShieldCheck, Radio, Activity, ArrowRight, X, ChevronRight, AlertTriangle,
} from "lucide-react";
import { createWatchProject, createWatcher } from "@/src/lib/actions/watch-dashboard";
import type { AccountProjectRow } from "@/src/lib/products/ownership";
import type {
  AccountWatcherRow, AccountCommunitySummary, AccountCapacity, AccountActivityItem, AttentionItem,
  CommunityOperationalStats,
} from "@/src/lib/products/watch-runtime";
import { communityOperationalStatus } from "@/src/lib/products/watch-status";
import { watchAccessLabel } from "@/src/lib/products/watch-plans";
import { WatchShell } from "./WatchShell";
import { WatcherConnectModal } from "./WatcherConnectModal";
import { relTime, StatCard, SectionHeader, EmptyRow, CapacityRow, OperationalStatusBadge, SeverityTag, WatcherNamesCell } from "./WatchUI";

/* ---------------------------------------------------------------- modal ---- */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm w-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="w-display text-base">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- overview ---- */

export function WatchDashboard({
  projects: initialProjects, watchers: initialWatchers, communities, capacity, activity, moderationActionsLast7Days,
  attentionItems = [], communityStats = {},
}: {
  projects: AccountProjectRow[];
  watchers: AccountWatcherRow[];
  communities: AccountCommunitySummary[];
  capacity: AccountCapacity | null;
  activity: AccountActivityItem[];
  moderationActionsLast7Days: number;
  attentionItems?: AttentionItem[];
  communityStats?: Record<string, CommunityOperationalStats>;
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [watchers, setWatchers] = useState(initialWatchers);
  const [modal, setModal] = useState<"project" | "watcher" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingWatcher, setConnectingWatcher] = useState<AccountWatcherRow | null>(null);

  const hasAnyResource = projects.length > 0 || watchers.length > 0 || communities.length > 0;
  // Distinct Watchers with at least one enabled deployment — NOT a count of
  // enabled deployments (a Watcher deployed to 2 communities would otherwise
  // be double-counted here while the Watchers table below only ever lists it
  // once, producing exactly the "Active Watchers = 4 but Watchers says none"
  // contradiction this definition fixes). Used only for the sub-note below,
  // never as the "Watcher slots" stat's own value -- a slot-labeled number
  // must always mean slots (active deployments), not distinct Watchers, or
  // it silently disagrees with Usage/Billing's own "Watcher slots" figure.
  const activeWatcherCount = new Set(
    communities.flatMap((c) => c.watchers.filter((w) => w.enabled).map((w) => w.watcherId))
  ).size;
  // Real slot usage (one active deployment = one slot), computed the exact
  // same way regardless of whether a plan is active -- so the stat card
  // never has to fall back to a differently-scoped number just because
  // `capacity` is null.
  const activeDeploymentCount = communities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length;

  const openModal = (kind: "project" | "watcher") => {
    setModal(kind);
    setName("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    if (modal === "project") {
      const res = await createWatchProject(name.trim());
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      window.location.reload(); // simplest correct refresh -- server data (capacity, etc.) stays in sync
    } else if (modal === "watcher") {
      const res = await createWatcher(name.trim());
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setWatchers((prev) => [...prev, res.data]);
      setModal(null);
    }
  };

  return (
    <WatchShell active="overview" capacity={capacity} attentionCount={attentionItems.length} primaryAction={{ label: "Create Watcher", onClick: () => openModal("watcher") }}>
      {!hasAnyResource ? (
        <OnboardingEmptyState onCreateProject={() => openModal("project")} />
      ) : (
        <div className="space-y-8">
          <div>
            <h1 className="w-display text-xl mb-1">Community operations</h1>
            <p className="text-sm w-text-dim">Monitor your Communities, Watchers, activity, and usage.</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Needs attention" value={attentionItems.length} note={attentionItems.length === 0 ? "all clear" : undefined} />
            <StatCard
              label="Watcher slots"
              value={capacity ? capacity.activeDeploymentCount : activeDeploymentCount}
              denominator={capacity ? String(capacity.slotsTotal) : undefined}
              note={`${activeWatcherCount} Watcher${activeWatcherCount === 1 ? "" : "s"} deployed`}
              progress={capacity ? (capacity.activeDeploymentCount / Math.max(1, capacity.slotsTotal)) * 100 : undefined}
            />
            <StatCard
              label="Communities"
              value={communities.length}
              denominator={capacity ? String(capacity.communitiesTotal) : undefined}
              note={capacity ? `${Math.max(0, capacity.communitiesTotal - capacity.communitiesUsed)} available` : undefined}
              progress={capacity ? (capacity.communitiesUsed / Math.max(1, capacity.communitiesTotal)) * 100 : undefined}
            />
            <StatCard label="Moderation actions" value={moderationActionsLast7Days} note="last 7 days" />
          </div>

          {attentionItems.length > 0 && (
            <div className="w-card p-4 border w-amber-border">
              <SectionHeader icon={AlertTriangle} title={`Needs attention (${attentionItems.length})`} />
              <ul className="space-y-1">
                {attentionItems.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="flex items-center justify-between gap-3 py-2 group">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <SeverityTag severity={item.severity} />
                        <span className="text-sm w-text-dim group-hover:w-text truncate">{item.text}</span>
                      </span>
                      <span className="text-xs w-teal shrink-0 flex items-center gap-1">{item.actionLabel} <ChevronRight size={12} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1fr] gap-5">
            <div className="w-card p-5">
              <SectionHeader icon={Users} title="Community health" action={<Link href="/communities" className="text-xs w-teal hover:underline">View all</Link>} />
              {communities.length === 0 ? (
                <EmptyRow text="No Communities connected yet." />
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                        <th className="font-semibold pb-2 px-1">Community</th>
                        <th className="font-semibold pb-2 px-1">Health</th>
                        <th className="font-semibold pb-2 px-1">Watchers</th>
                        <th className="font-semibold pb-2 px-1">Last activity</th>
                        <th className="font-semibold pb-2 px-1">Moderation (24h)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {communities.slice(0, 8).map((c) => {
                        const stats = communityStats[c.id];
                        return (
                          <tr key={c.id} className="border-t w-line-soft">
                            <td className="py-2.5 px-1"><Link href={`/communities/${c.id}`} className="w-text hover:w-teal">{c.title ?? c.chatId}</Link></td>
                            <td className="py-2.5 px-1"><OperationalStatusBadge status={communityOperationalStatus(c)} /></td>
                            <td className="py-2.5 px-1 text-xs"><WatcherNamesCell watchers={c.watchers} /></td>
                            <td className="py-2.5 px-1 w-text-dim">{stats?.lastActivityAt ? relTime(stats.lastActivityAt) : "—"}</td>
                            <td className="py-2.5 px-1 w-text-dim">{stats?.moderationCount24h ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="w-card p-5">
              <SectionHeader icon={ShieldCheck} title="Plan & capacity" action={<Link href="/plans" className="text-xs w-teal hover:underline">Manage</Link>} />
              {capacity ? (
                <div className="space-y-3">
                  <p className="w-display text-lg w-teal">{watchAccessLabel(capacity.tier)}</p>
                  <CapacityRow label="Watcher slots" used={capacity.activeDeploymentCount} total={capacity.slotsTotal} />
                  <CapacityRow label="Communities" used={capacity.communitiesUsed} total={capacity.communitiesTotal} />
                  <Link href="/usage" className="text-xs w-teal hover:underline inline-block pt-1">View usage</Link>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm w-text mb-1">No active plan</p>
                  <p className="text-xs w-text-faint mb-4">Watch is not currently subscribed.</p>
                  <Link href="/plans" className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg inline-block">Choose a plan</Link>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
            <div className="w-card p-5">
              <SectionHeader icon={Bot} title="Watchers" action={
                <div className="flex items-center gap-3">
                  <Link href="/watchers" className="text-xs w-teal hover:underline">View all</Link>
                  <button onClick={() => openModal("watcher")} className="text-xs w-teal hover:underline flex items-center gap-1">
                    <Plus size={12} /> New
                  </button>
                </div>
              } />
              {watchers.length === 0 ? (
                <EmptyRow text="No Watchers yet." />
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm min-w-[460px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                        <th className="font-semibold pb-2 px-1">Watcher</th>
                        <th className="font-semibold pb-2 px-1">Community</th>
                        <th className="font-semibold pb-2 px-1">Status</th>
                        <th className="font-semibold pb-2 px-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {watchers.slice(0, 8).map((w) => {
                        const deployment = communities.flatMap((c) => c.watchers.map((d) => ({ ...d, communityTitle: c.title ?? c.chatId }))).find((d) => d.watcherId === w.id);
                        return (
                          <tr key={w.id} className="border-t w-line-soft">
                            <td className="py-2.5 px-1 flex items-center gap-2"><Bot size={13} className="w-teal shrink-0" /> <Link href={`/watchers/${w.id}`} className="w-text hover:w-teal">{w.name}</Link></td>
                            <td className="py-2.5 px-1 w-text-dim">{deployment?.communityTitle ?? "Not deployed"}</td>
                            <td className="py-2.5 px-1">{deployment ? (deployment.enabled ? <span className="text-xs w-green">Active</span> : <span className="text-xs w-text-faint">Paused</span>) : <span className="text-xs w-text-faint">Idle</span>}</td>
                            <td className="py-2.5 px-1 text-right">
                              {!deployment && (
                                <button onClick={() => setConnectingWatcher(w)} className="text-xs w-teal hover:underline">
                                  {w.provisioningStatus === "active" || w.provisioningStatus === "bot_ready" || w.provisioningStatus === "community_setup_required" ? "Connect community" : "Connect"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="w-card p-5">
              <SectionHeader icon={Activity} title="Recent activity" action={<Link href="/activity" className="text-xs w-teal hover:underline">View all</Link>} />
              {activity.length === 0 ? (
                <EmptyRow text="No activity yet — activity appears here once a Watcher is live in a community." />
              ) : (
                <ul className="space-y-3">
                  {activity.map((item) => (
                    <li key={item.id} className="flex items-start gap-2.5">
                      <Radio size={13} className="w-teal shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs w-text leading-snug">
                          {item.watcherName ? <span className="font-medium">{item.watcherName}</span> : "A Watcher"} {item.description}
                        </p>
                        <p className="text-[11px] w-text-faint">{item.communityTitle} · {relTime(item.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="w-card p-5">
            <SectionHeader icon={FolderKanban} title="Projects" action={
              <div className="flex items-center gap-3">
                <Link href="/projects" className="text-xs w-teal hover:underline">View all</Link>
                <button onClick={() => openModal("project")} className="text-xs w-teal hover:underline flex items-center gap-1">
                  <Plus size={12} /> New
                </button>
              </div>
            } />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {projects.slice(0, 6).map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="w-surface-raised border w-line-soft rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-2 hover:w-teal-border">
                  <span className="text-sm w-text truncate">{p.name}</span>
                  <ChevronRight size={14} className="w-text-faint shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={modal === "project" ? "Create a Project" : "Create a Watcher"} onClose={() => setModal(null)}>
          <p className="text-sm w-text-dim mb-3">
            {modal === "project" ? "Give your Project a name to get started." : "Name your Watcher — you can configure its persona once it's created."}
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={modal === "project" ? "Project name" : "Watcher name"}
            className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
          />
          {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
          <button onClick={submit} disabled={busy || !name.trim()} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-60">
            <Plus size={14} /> {busy ? "Creating…" : "Create"}
          </button>
        </Modal>
      )}

      {connectingWatcher && (
        <WatcherConnectModal
          watcher={connectingWatcher}
          projects={projects}
          onClose={() => setConnectingWatcher(null)}
          onConnected={() => window.location.reload()}
        />
      )}
    </WatchShell>
  );
}

function OnboardingEmptyState({ onCreateProject }: { onCreateProject: () => void }) {
  const steps = ["Create a Project", "Connect a Community", "Create a Watcher", "Deploy it"];
  return (
    <div className="max-w-lg mx-auto text-center py-16">
      <div className="w-14 h-14 rounded-full w-teal-soft-bg border w-teal-border flex items-center justify-center mx-auto mb-5">
        <Bot size={24} className="w-teal" />
      </div>
      <h1 className="w-display text-xl mb-2">Set up Innvil Watch</h1>
      <p className="text-sm w-text-dim mb-6">Follow these steps to get your first Watcher live in a community.</p>
      <ol className="text-left space-y-2.5 mb-7 max-w-xs mx-auto">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-3 text-sm w-text">
            <span className="w-6 h-6 rounded-full w-surface-raised border w-line-soft flex items-center justify-center text-xs w-text-dim shrink-0">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <button onClick={onCreateProject} className="w-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-1.5">
        Start setup <ArrowRight size={14} />
      </button>
    </div>
  );
}
