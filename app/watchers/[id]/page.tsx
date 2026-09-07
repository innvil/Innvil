import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bot, Radio, Settings as SettingsIcon } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountWatcherDetail } from "@/src/lib/products/watch-runtime";
import { listAccountProjects } from "@/src/lib/products/ownership";
import { deploymentSummaries } from "@/src/lib/products/watch-status";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { StatusDot, EmptyRow, SectionHeader, relTime } from "@/src/components/watch/WatchUI";
import { WatchTabs, type WatchTab } from "@/src/components/watch/WatchTabs";
import { DeploymentToggle } from "@/src/components/watch/DeploymentToggle";
import { WatcherConnectCta } from "@/src/components/watch/WatcherDetailClient";
import { WatcherPersonaTab } from "@/src/components/watch/WatcherPersonaTab";
import { WatcherTelegramCard } from "@/src/components/watch/WatcherTelegramCard";
import { WatchersWorkspaceClient } from "@/src/components/watch/WatchersWorkspaceClient";

export const metadata: Metadata = { title: "Watcher — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

const STATUS_LABEL: Record<string, string> = {
  draft: "Not connected to Telegram yet",
  telegram_confirmation_pending: "Waiting on Telegram confirmation",
  bot_ready: "Bot connected — no Community yet",
  community_setup_required: "Bot connected — no Community yet",
  active: "Connected and deployed",
  requires_retry: "Connection needs a retry",
  cancelled: "Connection cancelled",
  username_unavailable: "Username unavailable — try another",
  telegram_creation_failed: "Telegram creation failed",
  credential_setup_failed: "Credential setup failed",
  expired: "Connection attempt expired",
  disconnected: "Telegram bot disconnected",
};

export default async function WatcherDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const { accountId, admin } = await requireWatchPage();
  const [shell, projects] = await Promise.all([
    getWatchShellContext(admin, accountId),
    listAccountProjects(admin, accountId),
  ]);
  const { communities, watchers: allWatchers } = shell;
  const detail = await getAccountWatcherDetail(admin, accountId, id, { communities, watchers: allWatchers });
  if (!detail) notFound();

  const hasActive = detail.deployments.some((d) => d.enabled);
  const moderationToday = detail.activity.filter((a) => {
    const d = new Date(a.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  const deploymentTable = (
    <div className="w-card p-5">
      <SectionHeader icon={Bot} title="Deployments" />
      {detail.provisioningStatus === "disconnected" && detail.deployments.length > 0 && (
        <p className="text-xs w-amber mb-3">
          This Watcher's Telegram bot is disconnected — these deployments are preserved but not currently
          operational. Reconnect a bot on the Settings tab to resume.
        </p>
      )}
      {detail.deployments.length === 0 ? (
        <EmptyRow text="This Watcher isn't deployed to any Community yet." />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                <th className="font-semibold pb-2 px-1">Community</th>
                <th className="font-semibold pb-2 px-1">Project</th>
                <th className="font-semibold pb-2 px-1">Status</th>
                <th className="font-semibold pb-2 px-1">Slot</th>
                <th className="font-semibold pb-2 px-1"></th>
              </tr>
            </thead>
            <tbody>
              {detail.deployments.map((d) => (
                <tr key={d.deploymentId} className="border-t w-line-soft">
                  <td className="py-2.5 px-1"><Link href={`/communities/${d.communityId}`} className="w-text hover:w-teal">{d.communityTitle}</Link></td>
                  <td className="py-2.5 px-1 w-text-dim">{d.projectName}</td>
                  <td className="py-2.5 px-1"><StatusDot on={d.enabled} /></td>
                  <td className="py-2.5 px-1 w-text-dim">{d.enabled ? "1 slot" : "—"}</td>
                  <td className="py-2.5 px-1 text-right"><DeploymentToggle moderatorId={detail.id} deploymentId={d.deploymentId} enabled={d.enabled} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const activityFeed = (
    <div className="w-card p-5">
      <SectionHeader icon={Radio} title="Activity from this Watcher" />
      {detail.activity.length === 0 ? (
        <EmptyRow text="No moderation activity recorded from this Watcher yet." />
      ) : (
        <ul className="space-y-3">
          {detail.activity.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5">
              <Radio size={13} className="w-teal shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs w-text leading-snug">{item.description}</p>
                <p className="text-[11px] w-text-faint">{item.communityTitle} · {relTime(item.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const tabs: WatchTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Status</p>
              <p className="w-display text-lg w-text">{hasActive ? "Active" : detail.deployments.length ? "Paused" : "Not deployed"}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Deployed to</p>
              <p className="w-display text-lg w-text">{detail.deployments.length} communit{detail.deployments.length === 1 ? "y" : "ies"}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Moderation today</p>
              <p className="w-display text-lg w-text">{moderationToday}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Last activity</p>
              <p className="w-display text-lg w-text">{detail.activity[0] ? relTime(detail.activity[0].createdAt) : "—"}</p>
            </div>
          </div>
          {deploymentTable}
          <div className="w-card p-5">
            <SectionHeader icon={Radio} title="Recent activity" />
            {detail.activity.length === 0 ? (
              <EmptyRow text="No moderation activity recorded from this Watcher yet." />
            ) : (
              <ul className="space-y-3">
                {detail.activity.slice(0, 6).map((item) => (
                  <li key={item.id} className="flex items-start gap-2.5">
                    <Radio size={13} className="w-teal shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs w-text leading-snug">{item.description}</p>
                      <p className="text-[11px] w-text-faint">{item.communityTitle} · {relTime(item.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ),
    },
    { id: "persona", label: "Persona", content: <WatcherPersonaTab moderatorId={detail.id} persona={detail.persona} /> },
    { id: "deployments", label: "Deployments", content: deploymentTable },
    { id: "activity", label: "Activity", content: activityFeed },
    {
      id: "settings",
      label: "Settings",
      content: (
        <div className="space-y-5">
          <div className="w-card p-5 max-w-lg">
            <SectionHeader icon={SettingsIcon} title="Watcher" />
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between"><span className="w-text-dim">Name</span><span className="w-text">{detail.name}</span></div>
              <div className="flex items-center justify-between"><span className="w-text-dim">Watcher ID</span><span className="w-text w-mono text-xs">{detail.id}</span></div>
              <div className="flex items-center justify-between"><span className="w-text-dim">Connection status</span><span className="w-text">{STATUS_LABEL[detail.provisioningStatus] ?? detail.provisioningStatus}</span></div>
              <div className="flex items-center justify-between"><span className="w-text-dim">Active deployments</span><span className="w-text">{detail.deployments.filter((d) => d.enabled).length}</span></div>
            </div>
            <p className="text-xs w-text-faint mt-4">
              Persona and behavior are edited on the Persona tab above. Renaming or deleting a Watcher isn't available yet.
            </p>
          </div>
          <WatcherTelegramCard moderatorId={detail.id} />
        </div>
      ),
    },
  ];

  const detailContent = (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs w-text-faint uppercase tracking-wide font-semibold mb-1 flex items-center gap-1.5"><Bot size={12} /> Watcher</p>
          <h1 className="w-display text-xl mb-1">{detail.name}</h1>
          <p className="text-sm w-text-dim">{STATUS_LABEL[detail.provisioningStatus] ?? detail.provisioningStatus}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot on={hasActive} onLabel="Active" offLabel={detail.deployments.length === 0 ? "Not deployed" : "Paused"} />
          <WatcherConnectCta watcher={detail} projects={projects} />
        </div>
      </div>
      <WatchTabs tabs={tabs} defaultTab={tab === "persona" || tab === "deployments" || tab === "activity" || tab === "settings" ? tab : "overview"} />
    </div>
  );

  return (
    <WatchShell active="watchers" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <WatchersWorkspaceClient
        watchers={allWatchers}
        deployments={deploymentSummaries(communities)}
        projects={projects}
        selectedId={id}
        detail={detailContent}
      />
    </WatchShell>
  );
}
