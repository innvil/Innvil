import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users, Bot, Radio, ArrowRight, LayoutGrid, Settings as SettingsIcon, MessageCircleQuestion } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountProjectDetail, listAccountActivity, communityOperationalStatus } from "@/src/lib/products/watch-runtime";
import { DEPLOYABLE_PROVISIONING_STATUSES } from "@/src/lib/products/watch-status";
import { getAccountProjectProfile } from "@/src/lib/actions/watch-project-profile";
import { listProjectEscalations, listProjectModerationReports } from "@/src/lib/actions/watch-escalations";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { Breadcrumbs, StatusDot, EmptyRow, SectionHeader, OperationalStatusBadge, relTime } from "@/src/components/watch/WatchUI";
import { WatchTabs, type WatchTab } from "@/src/components/watch/WatchTabs";
import { ProjectKnowledgeTab } from "@/src/components/watch/ProjectKnowledgeTab";
import { ProjectAddWatcherCta } from "@/src/components/watch/ProjectAddWatcherCta";
import { ProjectAddCommunityCta } from "@/src/components/watch/ProjectAddCommunityCta";
import { ProjectAddEscalationGroupCta } from "@/src/components/watch/ProjectAddEscalationGroupCta";
import { ProjectEscalationsTab } from "@/src/components/watch/ProjectEscalationsTab";
import { assignWatcherRoles } from "@/src/lib/moderator/watcher-roles";
import { DeploymentToggle } from "@/src/components/watch/DeploymentToggle";
import { CommunitySolicitationToggle } from "@/src/components/watch/CommunitySolicitationToggle";
import { AcknowledgeAdminModToggle } from "@/src/components/watch/AcknowledgeAdminModToggle";
import { MemberWelcomeToggle } from "@/src/components/watch/MemberWelcomeToggle";
import { CommunityTopicPolicies } from "@/src/components/watch/CommunityTopicPolicies";
import { PendingReplyDelayControl } from "@/src/components/watch/PendingReplyDelayControl";
import { PromotionChannelLinkControl } from "@/src/components/watch/PromotionChannelLinkControl";
import {
  SOLICITATION_DEFAULT_OFF_GUIDANCE, SOLICITATION_TOGGLE_HELPER_TEXT, PROMOTION_TOPIC_HELPER_TEXT,
} from "@/src/lib/moderator/community-guidance";

export const metadata: Metadata = { title: "Project — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accountId, admin } = await requireWatchPage();
  const shell = await getWatchShellContext(admin, accountId);
  const { communities, watchers: allWatchers } = shell;
  const [detail, profileResult, activity, escalationsResult, moderationReportsResult] = await Promise.all([
    getAccountProjectDetail(admin, accountId, id, communities),
    getAccountProjectProfile(id),
    listAccountActivity(admin, accountId, { projectId: id, limit: 20 }, communities),
    listProjectEscalations(id),
    listProjectModerationReports(id),
  ]);
  if (!detail) notFound();

  // Shared Escalation Group (Phase 1) -- an escalation-group community is
  // internal ops infrastructure, never customer-facing; excluded from every
  // capacity-adjacent count (0-slot billing is enforced server-side in
  // watch-runtime.ts, but the UI's own "N communities" figures must agree
  // with what actually counts toward the plan). Still rendered (labeled) in
  // the Communities/Watchers tables below -- just never counted here.
  const customerFacingCommunities = detail.communities.filter((c) => c.connectionType === "community");
  const attention = customerFacingCommunities.filter((c) => communityOperationalStatus(c) === "needs_attention");
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
  const activeDeploymentsInProject = customerFacingCommunities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length;

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
              <p className="w-display text-lg w-text">{customerFacingCommunities.length}</p>
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
      id: "escalations",
      label: "Watcher Ops",
      content: escalationsResult.ok ? (
        <ProjectEscalationsTab
          initialEscalations={escalationsResult.data}
          initialModerationReports={moderationReportsResult.ok ? moderationReportsResult.data : []}
          hasEscalationGroup={detail.communities.some((c) => c.connectionType === "escalation_group")}
        />
      ) : (
        <EmptyRow text={escalationsResult.error} />
      ),
    },
    {
      // A Project is meant to hold exactly one customer-facing Community in
      // the common case, so its settings live directly on the Project
      // dashboard now (2026-09-02) -- no separate click into a Community
      // page is needed to reach them. This tab renders the FULL settings
      // block (Watchers with pause/resume, Solicitation, Acknowledge Admin/
      // Mod, Topic Policies, human-priority reply delay) inline for every
      // real (non-escalation-group) Community in the Project -- normally
      // just one, but a Project with more than one still gets every
      // Community's full settings shown, never a bare list requiring a
      // further click. /communities/[id] still exists as a fallback/deep
      // link (e.g. from Activity items).
      id: "moderation",
      label: "Moderation",
      content: (
        <div className="space-y-6">
          <div className="w-card p-4 border w-amber-border">
            <p className="text-sm w-text-dim">{SOLICITATION_DEFAULT_OFF_GUIDANCE}</p>
          </div>
          {customerFacingCommunities.length === 0 ? (
            <div className="w-card p-5">
              <div className="flex items-center justify-between mb-3">
                <SectionHeader icon={Users} title="Community" />
                <div className="flex items-center gap-2">
                  <ProjectAddCommunityCta projectId={detail.id} deployableWatchers={deployableWatchers} />
                  <ProjectAddEscalationGroupCta projectId={detail.id} deployableWatchers={deployableWatchers} />
                </div>
              </div>
              <div className="text-center py-8">
                <EmptyRow text="No Community connected to this Project yet." />
                <p className="text-xs w-text-faint">Use Add Community above to connect one to this Project.</p>
              </div>
            </div>
          ) : (
            customerFacingCommunities.map((c) => {
              return (
                <div key={c.id} className="w-card p-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                    <div>
                      <h2 className="w-display text-base w-text">{c.title ?? c.chatId}</h2>
                      <p className="text-xs w-text-dim capitalize">{c.platform} · <span className="w-mono">{c.chatId}</span></p>
                    </div>
                    <OperationalStatusBadge status={communityOperationalStatus(c)} />
                  </div>

                  {/* Watcher listing/pause-resume/Add-Watcher for this Community lives
                      exclusively on this page's own separate "Watchers" tab -- showing
                      it here too was a real, reported redundancy (removed 2026-09-03).
                      This tab is Community CONFIGURATION only: identity above, moderation
                      settings below. */}
                  <div className="pt-1">
                    <SectionHeader icon={SettingsIcon} title="Moderation" />
                    <CommunitySolicitationToggle communityId={c.id} allowSolicitation={c.allowSolicitation} />
                    <p className="text-[11px] w-text-faint mt-1.5">{SOLICITATION_TOGGLE_HELPER_TEXT}</p>
                    <AcknowledgeAdminModToggle communityId={c.id} acknowledgeAdminMod={c.acknowledgeAdminMod} />
                    {c.connectionType !== "escalation_group" && <MemberWelcomeToggle communityId={c.id} initialEnabled={c.welcomeNewMembers === true} />}
                    <div className="mt-4">
                      <CommunityTopicPolicies communityId={c.id} />
                      <p className="text-[11px] w-text-faint mt-1.5">{PROMOTION_TOPIC_HELPER_TEXT}</p>
                      <PromotionChannelLinkControl communityId={c.id} />
                    </div>
                    <PendingReplyDelayControl communityId={c.id} />
                  </div>
                </div>
              );
            })
          )}
          {detail.communities.some((c) => c.connectionType === "escalation_group") && (
            <div className="w-card p-4">
              <p className="text-xs w-text-faint">
                This Project also has a connected Escalation Group — manage it on the{" "}
                <Link href="/communities" className="w-teal hover:underline">Communities</Link> page.
              </p>
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
            {detail.communities.length > 0 && (
              <ProjectAddWatcherCta projectId={detail.id} deployableWatchers={deployableWatchers} communities={projectCommunityOptions} />
            )}
          </div>
          {detail.communities.length === 0 ? (
            <div className="text-center py-8">
              <EmptyRow text="No Watchers assigned to a Community in this Project yet." />
              <p className="text-xs w-text-faint">Add a Community first (Community tab), then deploy a Watcher to it here.</p>
            </div>
          ) : watchersInProject.length === 0 ? (
            <EmptyRow text="No Watchers assigned to a Community in this Project yet." />
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold pb-2 px-1">Watcher</th>
                    <th className="font-semibold pb-2 px-1">Community</th>
                    <th className="font-semibold pb-2 px-1">Role</th>
                    <th className="font-semibold pb-2 px-1">Status</th>
                    <th className="font-semibold pb-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.communities.flatMap((c) => {
                    // Role is scoped to THIS community's own deployment set
                    // (Watcher Role Separation is automatic, computed from
                    // deployment order+count within one Community) --
                    // recomputed per community, never shared across them.
                    const roles = assignWatcherRoles(c.watchers.map((w) => ({ deploymentId: w.deploymentId, createdAt: w.createdAt, enabled: w.enabled })));
                    return c.watchers.map((w) => {
                      const role = roles.find((r) => r.deploymentId === w.deploymentId);
                      return (
                        <tr key={w.deploymentId} className="border-t w-line-soft">
                          <td className="py-2.5 px-1"><Link href={`/watchers/${w.watcherId}`} className="w-text hover:w-teal flex items-center gap-2"><Bot size={13} className="w-teal shrink-0" /> {w.watcherName}</Link></td>
                          <td className="py-2.5 px-1 w-text-dim">
                            {c.title ?? c.chatId}
                            {c.connectionType === "escalation_group" && <span className="ml-1.5 text-[10px] uppercase tracking-wide w-text-faint">(Escalation Group)</span>}
                          </td>
                          <td className="py-2.5 px-1 w-text-dim text-xs">{w.enabled ? role?.roleLabel : "—"}</td>
                          <td className="py-2.5 px-1"><StatusDot on={w.enabled} /></td>
                          <td className="py-2.5 px-1 text-right"><DeploymentToggle moderatorId={w.watcherId} deploymentId={w.deploymentId} enabled={w.enabled} /></td>
                        </tr>
                      );
                    });
                  })}
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
            <div className="flex items-center justify-between"><span className="w-text-dim">Communities</span><span className="w-text">{customerFacingCommunities.length}</span></div>
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
            {customerFacingCommunities.length} communit{customerFacingCommunities.length === 1 ? "y" : "ies"} · {detail.watcherCount} watcher{detail.watcherCount === 1 ? "" : "s"}
          </p>
        </div>
        <WatchTabs tabs={tabs} />
      </div>
    </WatchShell>
  );
}
