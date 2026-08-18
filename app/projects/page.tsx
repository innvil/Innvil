import Link from "next/link";
import type { Metadata } from "next";
import { FolderKanban, ChevronRight } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { listAccountProjects } from "@/src/lib/products/ownership";
import { listAccountCommunities } from "@/src/lib/products/watch-runtime";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { EmptyRow } from "@/src/components/watch/WatchUI";
import { CreateProjectButton } from "@/src/components/watch/ProjectsClient";

export const metadata: Metadata = { title: "Projects — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function ProjectsPage() {
  const { accountId, admin } = await requireWatchPage();
  const [projects, communities, shell] = await Promise.all([
    listAccountProjects(admin, accountId),
    listAccountCommunities(admin, accountId),
    getWatchShellContext(admin, accountId),
  ]);

  const communityCountByProject = new Map<string, number>();
  const watcherCountByProject = new Map<string, Set<string>>();
  for (const c of communities) {
    communityCountByProject.set(c.projectId, (communityCountByProject.get(c.projectId) ?? 0) + 1);
    const existing = watcherCountByProject.get(c.projectId) ?? new Set<string>();
    for (const w of c.watchers) existing.add(w.watcherId);
    watcherCountByProject.set(c.projectId, existing);
  }

  return (
    <WatchShell active="projects" capacity={shell.capacity} attentionCount={shell.attentionCount}>
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
