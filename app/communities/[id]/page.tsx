import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bot, Radio, Settings as SettingsIcon } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { listAccountActivity, communityOperationalStatus } from "@/src/lib/products/watch-runtime";
import { MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/products/watch-plans";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { Breadcrumbs, EmptyRow, SectionHeader, relTime, OperationalStatusBadge } from "@/src/components/watch/WatchUI";
import { WatchTabs, type WatchTab } from "@/src/components/watch/WatchTabs";
import { DeploymentToggle } from "@/src/components/watch/DeploymentToggle";
import { CommunityModerationFilters } from "@/src/components/watch/CommunityModerationFilters";
import { PresenceScheduleCard } from "@/src/components/watch/PresenceScheduleCard";
import { getCommunityPresenceSchedule } from "@/src/lib/actions/watch-presence";
import { AutoPostScheduleCard } from "@/src/components/watch/AutoPostScheduleCard";
import { getAutoPostingEligibility } from "@/src/lib/actions/watch-autopost";
import { AUTO_POSTING_ENABLED } from "@/src/lib/moderator/plan";
import { CommunitySolicitationToggle } from "@/src/components/watch/CommunitySolicitationToggle";
import { AcknowledgeAdminModToggle } from "@/src/components/watch/AcknowledgeAdminModToggle";
import { ModerationNoticeCooldown } from "@/src/components/watch/ModerationNoticeCooldown";
import { ExternalBotCleanupToggle } from "@/src/components/watch/ExternalBotCleanupToggle";
import { MemberWelcomeToggle } from "@/src/components/watch/MemberWelcomeToggle";
import { CommunityTopicPolicies } from "@/src/components/watch/CommunityTopicPolicies";
import { PendingReplyDelayControl } from "@/src/components/watch/PendingReplyDelayControl";
import { PromotionChannelLinkControl } from "@/src/components/watch/PromotionChannelLinkControl";
import { assignWatcherRoles } from "@/src/lib/moderator/watcher-roles";
import {
  SOLICITATION_DEFAULT_OFF_GUIDANCE, SOLICITATION_TOGGLE_HELPER_TEXT,
  PROMOTION_TOPIC_HELPER_TEXT, SOLICITATION_SETTINGS_ANCHOR_ID, PROMOTION_TOPIC_ANCHOR_ID,
  solicitationSettingsHref, promotionTopicHref,
} from "@/src/lib/moderator/community-guidance";
import { ShieldAlert } from "lucide-react";

export const metadata: Metadata = { title: "Community — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function CommunityDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ watcher?: string; days?: string; tab?: string }>;
}) {
  const { id } = await params;
  const { watcher: watcherId, days, tab } = await searchParams;
  const { accountId, admin } = await requireWatchPage();
  const daysNum = Number(days) || 7;
  const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();

  const shell = await getWatchShellContext(admin, accountId);
  const { communities } = shell;
  const community = communities.find((c) => c.id === id);
  if (!community) notFound();

  const [recentActivity, filteredModeration] = await Promise.all([
    listAccountActivity(admin, accountId, { communityId: id, limit: 8 }, communities),
    listAccountActivity(admin, accountId, { communityId: id, watcherId: watcherId || undefined, since, limit: 100 }, communities),
  ]);

  const status = communityOperationalStatus(community);
  const watchersForFilter = community.watchers.map((w) => ({ id: w.watcherId, name: w.watcherName }));
  // Watcher Role Separation is fully automatic (no manual "set role" control
  // exists, or should exist -- it's deterministic, computed from deployment
  // order + count) -- but it must still be VISIBLE wherever an owner
  // naturally looks at a Community's Watchers, not only on the separate
  // global /deployments page.
  const roleAssignments = assignWatcherRoles(community.watchers.map((w) => ({ deploymentId: w.deploymentId, createdAt: w.createdAt, enabled: w.enabled })));
  const presenceResult = await getCommunityPresenceSchedule(id);
  const autoPostEligibility = AUTO_POSTING_ENABLED ? await getAutoPostingEligibility(id) : null;

  const watchersTab = (
    <div className="w-card p-5">
      <SectionHeader icon={Bot} title="Watchers deployed here" />
      {community.watchers.length === 0 ? (
        <EmptyRow text="No Watchers deployed to this Community." />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[540px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                <th className="font-semibold pb-2 px-1">Watcher</th>
                <th className="font-semibold pb-2 px-1">Role</th>
                <th className="font-semibold pb-2 px-1">Status</th>
                <th className="font-semibold pb-2 px-1"></th>
              </tr>
            </thead>
            <tbody>
              {community.watchers.map((w) => {
                const role = roleAssignments.find((r) => r.deploymentId === w.deploymentId);
                return (
                  <tr key={w.deploymentId} className="border-t w-line-soft">
                    <td className="py-2.5 px-1"><Link href={`/watchers/${w.watcherId}`} className="w-text hover:w-teal flex items-center gap-2"><Bot size={13} className="w-teal shrink-0" /> {w.watcherName}</Link></td>
                    <td className="py-2.5 px-1">
                      {w.enabled ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs w-text-dim">{role?.roleLabel}</span>
                          {role?.chatterDuty === "ACTIVE_CHATTER" ? (
                            <span className="text-[10px] w-teal flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full w-teal-bg shrink-0" /> Active chatter now</span>
                          ) : (
                            <span className="text-[10px] w-text-faint">Specialist duty only right now</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs w-text-faint">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-1">{w.enabled ? <span className="text-xs w-green">Active</span> : <span className="text-xs w-text-faint">Paused</span>}</td>
                    <td className="py-2.5 px-1 text-right"><DeploymentToggle moderatorId={w.watcherId} deploymentId={w.deploymentId} enabled={w.enabled} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const tabs: WatchTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="space-y-6">
          <div className="w-card p-5 border w-amber-border">
            <SectionHeader icon={ShieldAlert} title="Solicitation &amp; promotion" />
            <p className="text-sm w-text-dim mt-1">{SOLICITATION_DEFAULT_OFF_GUIDANCE}</p>
            <p className="text-sm w-text-dim mt-2">
              If you want to allow solicitation across your entire community, enable it in{" "}
              <Link href={solicitationSettingsHref()} className="w-teal hover:underline font-medium">Solicitation Settings</Link>.
              Otherwise, we recommend creating or assigning a dedicated{" "}
              <Link href={promotionTopicHref()} className="w-teal hover:underline font-medium">Promotion topic</Link>.
              When a Promotion topic is configured, the Watcher can direct members there when they try to promote in General, Announcements, or other non-promotion topics.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Link href={solicitationSettingsHref()} className="w-pill text-xs w-teal-border w-teal-soft-bg w-teal">Solicitation Settings</Link>
              <Link href={promotionTopicHref()} className="w-pill text-xs w-teal-border w-teal-soft-bg w-teal">Configure Promotion Topic</Link>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Active deployments</p>
              <p className="w-display text-lg w-text">{community.watchers.filter((w) => w.enabled).length} <span className="text-sm w-text-faint font-normal">/ {MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} max</span></p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Moderation (7d)</p>
              <p className="w-display text-lg w-text">{recentActivity.length >= 8 ? "8+" : recentActivity.length}</p>
            </div>
            <div className="w-card p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Last activity</p>
              <p className="w-display text-lg w-text">{recentActivity[0] ? relTime(recentActivity[0].createdAt) : "—"}</p>
            </div>
          </div>
          {watchersTab}
          <div className="w-card p-5">
            <SectionHeader icon={Radio} title="Recent moderation" />
            {recentActivity.length === 0 ? (
              <EmptyRow text="No moderation activity recorded here yet." />
            ) : (
              <ul className="space-y-3">
                {recentActivity.map((item) => (
                  <li key={item.id} className="flex items-start gap-2.5">
                    <Radio size={13} className="w-teal shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs w-text leading-snug">{item.watcherId ? <Link href={`/watchers/${item.watcherId}`} className="font-medium hover:w-teal">{item.watcherName}</Link> : "A Watcher"} {item.description}</p>
                      <p className="text-[11px] w-text-faint">{relTime(item.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ),
    },
    { id: "watchers", label: "Watchers", content: watchersTab },
    ...(presenceResult.ok
      ? [{ id: "presence", label: "Presence", content: <PresenceScheduleCard communityId={id} initial={presenceResult.data} /> } as WatchTab]
      : []),
    ...(autoPostEligibility?.ok
      ? [{
          id: "autopost", label: "Auto-Posting",
          content: <AutoPostScheduleCard communityId={id} deployableCount={community.watchers.filter((w) => w.enabled).length} eligible={autoPostEligibility.data.eligible} />,
        } as WatchTab]
      : []),
    {
      id: "moderation",
      label: "Moderation",
      content: (
        <div className="space-y-4">
          <CommunityModerationFilters communityId={id} watchers={watchersForFilter} />
          <div className="w-card p-0 overflow-hidden">
            {filteredModeration.length === 0 ? (
              <div className="py-10"><EmptyRow text="No moderation actions match this filter." /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                      <th className="font-semibold py-3 px-4">Action</th>
                      <th className="font-semibold py-3 px-4">Watcher</th>
                      <th className="font-semibold py-3 px-4">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModeration.map((item) => (
                      <tr key={item.id} className="border-t w-line-soft">
                        <td className="py-2.5 px-4 w-text">{item.description}</td>
                        <td className="py-2.5 px-4 w-text-dim">{item.watcherId ? <Link href={`/watchers/${item.watcherId}`} className="hover:w-teal">{item.watcherName}</Link> : "—"}</td>
                        <td className="py-2.5 px-4 w-text-faint">{relTime(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "settings",
      label: "Settings",
      content: (
        <div className="w-card p-5 max-w-lg">
          <SectionHeader icon={SettingsIcon} title="Connection" />
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between"><span className="w-text-dim">Platform</span><span className="w-text capitalize">{community.platform}</span></div>
            <div className="flex items-center justify-between"><span className="w-text-dim">Chat ID</span><span className="w-text w-mono text-xs">{community.chatId}</span></div>
            <div className="flex items-center justify-between"><span className="w-text-dim">Project</span><Link href={`/projects/${community.projectId}`} className="w-teal hover:underline">{community.projectName}</Link></div>
          </div>
          <p className="text-xs w-text-faint mt-4">
            To reconnect or add another Watcher to this Community, use the Connect flow on the{" "}
            <Link href="/watchers" className="w-teal hover:underline">Watchers page</Link>.
          </p>
          <div className="mt-5 pt-5 border-t w-line-soft">
            <SectionHeader icon={SettingsIcon} title="Moderation" />
            <div id={SOLICITATION_SETTINGS_ANCHOR_ID} className="scroll-mt-24">
              <CommunitySolicitationToggle communityId={community.id} allowSolicitation={community.allowSolicitation} />
              <p className="text-[11px] w-text-faint mt-1.5">{SOLICITATION_TOGGLE_HELPER_TEXT}</p>
            </div>
            <AcknowledgeAdminModToggle communityId={community.id} acknowledgeAdminMod={community.acknowledgeAdminMod} />
            <ModerationNoticeCooldown communityId={community.id} initialMinutes={community.moderationNoticeCooldownMinutes ?? 30} />
            {community.connectionType !== "escalation_group" && <ExternalBotCleanupToggle communityId={community.id} initialEnabled={community.removeExternalBotMessages === true} />}
            {community.connectionType !== "escalation_group" && <MemberWelcomeToggle communityId={community.id} initialEnabled={community.welcomeNewMembers === true} />}
            <div id={PROMOTION_TOPIC_ANCHOR_ID} className="scroll-mt-24 mt-4">
              <CommunityTopicPolicies communityId={community.id} />
              <p className="text-[11px] w-text-faint mt-1.5">{PROMOTION_TOPIC_HELPER_TEXT}</p>
              <PromotionChannelLinkControl communityId={community.id} />
            </div>
            <PendingReplyDelayControl communityId={community.id} />
          </div>
        </div>
      ),
    },
  ];

  return (
    <WatchShell active="communities" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6">
        <Breadcrumbs items={[{ href: "/communities", label: "Communities" }, { label: community.title ?? community.chatId }]} />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="w-display text-xl mb-1">{community.title ?? community.chatId}</h1>
            <p className="text-sm w-text-dim">
              <Link href={`/projects/${community.projectId}`} className="hover:w-text">{community.projectName}</Link> · <span className="capitalize">{community.platform}</span>
            </p>
          </div>
          <OperationalStatusBadge status={status} />
        </div>
        <WatchTabs tabs={tabs} defaultTab={tab || (watcherId || days ? "moderation" : "overview")} />
      </div>
    </WatchShell>
  );
}
