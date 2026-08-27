import type { Metadata } from "next";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { listAccountProjects } from "@/src/lib/products/ownership";
import { deploymentSummaries } from "@/src/lib/products/watch-status";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { WatchersWorkspaceClient } from "@/src/components/watch/WatchersWorkspaceClient";

export const metadata: Metadata = { title: "Watchers — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

/** The Watchers workspace with no Watcher selected -- the master/detail
 *  shell's "nothing picked yet" state (WatchersWorkspaceClient). On mobile
 *  this IS the Watcher list screen; on desktop the navigator renders
 *  alongside an empty-state detail pane. See app/watchers/[id]/page.tsx for
 *  the selected-Watcher counterpart -- both routes render the SAME
 *  navigator via the SAME shared client shell, never a separate list page. */
export default async function WatchersPage() {
  const { accountId, admin } = await requireWatchPage();
  const [shell, projects] = await Promise.all([
    getWatchShellContext(admin, accountId),
    listAccountProjects(admin, accountId),
  ]);

  return (
    <WatchShell active="watchers" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <WatchersWorkspaceClient
        watchers={shell.watchers}
        deployments={deploymentSummaries(shell.communities)}
        projects={projects}
        selectedId={null}
        detail={null}
      />
    </WatchShell>
  );
}
