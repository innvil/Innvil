"use client";

import Link from "next/link";
import { FolderKanban, ChevronRight } from "lucide-react";
import useSWR from "swr";
import { getProjectsPageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { WatchShell } from "./WatchShell";
import { EmptyRow } from "./WatchUI";
import { CreateProjectButton } from "./ProjectsClient";
import { TableSkeleton } from "./DashboardSkeletons";

/** Cache-first `/projects` -- same pattern as WatchersPageClient/
 *  CommunitiesPageClient. */
export function ProjectsPageClient() {
  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.projects, getProjectsPageData, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) {
    return (
      <WatchShell active="projects" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  if (!data.authenticated) {
    if (typeof window !== "undefined") window.location.href = "/";
    return (
      <WatchShell active="projects" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  const { projects, communities, capacity, attentionCount } = data;

  const communityCountByProject = new Map<string, number>();
  const watcherCountByProject = new Map<string, Set<string>>();
  for (const c of communities) {
    communityCountByProject.set(c.projectId, (communityCountByProject.get(c.projectId) ?? 0) + 1);
    const existing = watcherCountByProject.get(c.projectId) ?? new Set<string>();
    for (const w of c.watchers) existing.add(w.watcherId);
    watcherCountByProject.set(c.projectId, existing);
  }

  return (
    <WatchShell active="projects" capacity={capacity} attentionCount={attentionCount}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="w-display text-xl mb-1">Projects</h1>
            <p className="text-sm w-text-dim">Workspaces that group your Communities and Watchers.</p>
          </div>
          <CreateProjectButton />
        </div>

        {projects.length === 0 ? (
          <div className="w-card p-10 text-center">
            <FolderKanban size={28} className="w-teal mx-auto mb-3" />
            <EmptyRow text="No Projects yet — create one to start connecting Communities and Watchers." />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => {
              const watcherCount = watcherCountByProject.get(p.id)?.size ?? 0;
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="w-card p-4 hover:w-teal-border transition-colors block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="w-display text-sm w-text truncate mb-1">{p.name}</p>
                      <p className="text-xs w-text-faint">
                        {communityCountByProject.get(p.id) ?? 0} communit{(communityCountByProject.get(p.id) ?? 0) === 1 ? "y" : "ies"} · {watcherCount} watcher{watcherCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <ChevronRight size={16} className="w-text-faint shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </WatchShell>
  );
}
