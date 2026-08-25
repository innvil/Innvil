import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users, Bot, Radio, ArrowRight, LayoutGrid, Settings as SettingsIcon } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountProjectDetail, listAccountActivity, listAccountWatchers, communityOperationalStatus } from "@/src/lib/products/watch-runtime";
import { DEPLOYABLE_PROVISIONING_STATUSES } from "@/src/lib/products/watch-status";
import { getAccountProjectProfile } from "@/src/lib/actions/watch-project-profile";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { Breadcrumbs, StatusDot, EmptyRow, SectionHeader, OperationalStatusBadge, relTime } from "@/src/components/watch/WatchUI";
import { WatchTabs, type WatchTab } from "@/src/components/watch/WatchTabs";
import { ProjectKnowledgeTab } from "@/src/components/watch/ProjectKnowledgeTab";
import { ProjectAddWatcherCta } from "@/src/components/watch/ProjectAddWatcherCta";

export const metadata: Metadata = { title: "Project — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accountId, admin } = await requireWatchPage();
  const [detail, profileResult, activity, shell, allWatchers] = await Promise.all([
    getAccountProjectDetail(admin, accountId, id),
    getAccountProjectProfile(id),
    listAccountActivity(admin, accountId, { projectId: id, limit: 20 }),
    getWatchShellContext(admin, accountId),
    listAccountWatchers(admin, accountId),
  ]);
  if (!detail) notFound();

  const attention = detail.communities.filter((c) => communityOperationalStatus(c) === "needs_attention");
  const watchersInProject = Array.from(
    new Map(detail.communities.flatMap((c) => c.watchers.map((w) => [w.watcherId, w]))).values()
  );
  // Only Watchers whose Telegram bot is already connected are offered for
  // Project-centric deployment (deployExistingWatcherToCommunity/
  // connectAccountCommunity both require this) -- a not-yet-connected
  // Watcher is still created/connected from Watchers first, never a second
  // bot-provisioning flow duplicated here (see ProjectDeployWatcherModal's
  // own doc comment).
  const deployableWatchers = allWatchers.filter((w) => DEPLOYABLE_PROVISIONING_STATUSES.has(w.provisioningStatus));
  const projectCommunityOptions = detail.communities.map((c) => ({ id: c.id, title: c.title, chatId: c.chatId }));

  const profileComplete = profileResult.ok && (profileResult.data.overview.trim().length > 0 || profileResult.data.description.trim().length > 0);
  // Same canonical distinction as Overview/Usage/Billing -- a Watcher PROFILE
  // count and an active DEPLOYMENT (slot) count are different numbers, and
  // showing only one at the Project level would reintroduce the exact
  // ambiguity already fixed globally.
  const activeDeploymentsInProject = detail.communities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length;

  const tabs: WatchTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Profile status</p>
              <p className="w-display text-lg w-text">{profileComplete ? "Complete" : "Not started"}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Communities</p>
              <p className="w-display text-lg w-text">{detail.communities.length}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Watcher profiles</p>
              <p className="w-display text-lg w-text">{detail.watcherCount}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Active deployments</p>
              <p className="w-display text-lg w-text">{activeDeploymentsInProject}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Slots used</p>
              <p className="w-display text-lg w-text">{activeDeploymentsInProject}</p>
            </div>
          </div>

          {attention.length > 0 && (
            <div className="w-card p-4 border w-amber-border">
              <SectionHeader icon={Users} title={`Needs attention (${attention.length})`} />
              <ul className="space-y-2">
                {attention.map((c) => (
                  <li key={c.id}>
                    <Link href={`/communities/${c.id}`} className="text-sm w-text-dim hover:w-text flex items-center justify-between gap-2">
                      <span>{c.title ?? c.chatId} has no active Watcher</span>
                      <ArrowRight size={13} className="w-text-faint shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="w-card p-5">
            <SectionHeader icon={Radio} title="Recent activity" />
            {activity.length === 0 ? (
              <EmptyRow text="No activity recorded in this Project yet." />
            ) : (
              <ul className="space-y-3">
                {activity.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex items-start gap-2.5">
                    <Radio size={13} className="w-teal shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs w-text leading-snug">{item.watcherId ? <Link href={`/watchers/${item.watcherId}`} className="font-medium hover:w-teal">{item.watcherName}</Link> : "A Watcher"} {item.description}</p>
                      <p className="text-[11px] w-text-faint"><Link href={`/communities/${item.communityId}`} className="hover:w-text-dim">{item.communityTitle}</Link> · {relTime(item.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "knowledge",
      label: "Knowledge",
      content: profileResult.ok ? (
        <ProjectKnowledgeTab projectId={id} profile={profileResult.data} />
      ) : (
        <EmptyRow text={profileResult.error} />
      ),
    },
    {
      id: "communities",
      label: "Communities",
      content: (
        <div className="w-card p-5">
          <div className="flex items-center justify-between mb-3">
            <SectionHeader icon={Users} title="Communities" />
            <ProjectAddWatcherCta projectId={detail.id} deployableWatchers={deployableWatchers} communities={projectCommunityOptions} />
          </div>
          {detail.communities.length === 0 ? (
            <div className="text-center py-8">
              <EmptyRow text="No Communities connected to this Project yet." />
              <p className="text-xs w-text-faint">
                Use Add Watcher above to connect one directly to this Project.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold pb-2 px-1">Community</th>
                    <th className="font-semibold pb-2 px-1">Watchers</th>
                    <th className="font-semibold pb-2 px-1">Status</th>
                    <th className="font-semibold pb-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.communities.map((c) => (
                    <tr key={c.id} className="border-t w-line-soft">
                      <td className="py-2.5 px-1 w-text">{c.title ?? c.chatId}</td>
                      <td className="py-2.5 px-1 w-text-dim">{c.watchers.length}</td>
                      <td className="py-2.5 px-1"><OperationalStatusBadge status={communityOperationalStatus(c)} /></td>
                      <td className="py-2.5 px-1 text-right"><Link href={`/communities/${c.id}`} className="text-xs w-teal hover:underline">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "watchers",
      label: "Watchers",
      content: (
        <div className="w-card p-5">
          <div className="flex items-center justify-between mb-3">
            <SectionHeader icon={Bot} title="Watchers deployed in this Project" />
            <ProjectAddWatcherCta projectId={detail.id} deployableWatchers={deployableWatchers} communities={projectCommunityOptions} />
          </div>
          {watchersInProject.length === 0 ? (
            <EmptyRow text="No Watchers assigned to a Community in this Project yet." />
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold pb-2 px-1">Watcher</th>
                    <th className="font-semibold pb-2 px-1">Community</th>
                    <th className="font-semibold pb-2 px-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.communities.flatMap((c) => c.watchers.map((w) => (
                    <tr key={w.deploymentId} className="border-t w-line-soft">
                      <td className="py-2.5 px-1"><Link href={`/watchers/${w.watcherId}`} className="w-text hover:w-teal flex items-center gap-2"><Bot size={13} className="w-teal shrink-0" /> {w.watcherName}</Link></td>
                      <td className="py-2.5 px-1 w-text-dim">{c.title ?? c.chatId}</td>
                      <td className="py-2.5 px-1"><StatusDot on={w.enabled} /></td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "activity",
      label: "Activity",
      content: (
        <div className="w-card p-5">
          {activity.length === 0 ? (
            <EmptyRow text="No activity recorded in this Project yet." />
          ) : (
            <ul className="space-y-4">
              {activity.map((item) => (
                <li key={item.id} className="flex items-start gap-3 border-b w-line-soft pb-4 last:border-0 last:pb-0">
                  <Radio size={14} className="w-teal shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm w-text leading-snug">{item.watcherId ? <Link href={`/watchers/${item.watcherId}`} className="font-medium hover:w-teal">{item.watcherName}</Link> : "A Watcher"} {item.description}</p>
                    <p className="text-xs w-text-faint mt-0.5"><Link href={`/communities/${item.communityId}`} className="hover:w-text-dim">{item.communityTitle}</Link> · {relTime(item.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      id: "settings",
      label: "Settings",
      content: (
        <div className="w-card p-5 max-w-lg">
          <SectionHeader icon={SettingsIcon} title="Project" />
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between"><span className="w-text-dim">Name</span><span className="w-text">{detail.name}</span></div>
            <div className="flex items-center justify-between"><span className="w-text-dim">Project ID</span><span className="w-text w-mono text-xs">{detail.id}</span></div>
            <div className="flex items-center justify-between"><span className="w-text-dim">Communities</span><span className="w-text">{detail.communities.length}</span></div>
            <div className="flex items-center justify-between"><span className="w-text-dim">Watcher profiles</span><span className="w-text">{detail.watcherCount}</span></div>
          </div>
          <p className="text-xs w-text-faint mt-4">
            Profile and knowledge fields are edited on the Knowledge tab above. Renaming a Project isn't available yet.
          </p>
        </div>
      ),
    },
  ];

  return (
    <WatchShell active="projects" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6">
        <Breadcrumbs items={[{ href: "/projects", label: "Projects" }, { label: detail.name }]} />
        <div>
          <p className="text-xs w-text-faint uppercase tracking-wide font-semibold mb-1 flex items-center gap-1.5"><LayoutGrid size={12} /> Project</p>
          <h1 className="w-display text-xl mb-1">{detail.name}</h1>
          <p className="text-sm w-text-dim">
            {detail.communities.length} communit{detail.communities.length === 1 ? "y" : "ies"} · {detail.watcherCount} watcher{detail.watcherCount === 1 ? "" : "s"}
          </p>
        </div>
        <WatchTabs tabs={tabs} />
      </div>
    </WatchShell>
  );
}
