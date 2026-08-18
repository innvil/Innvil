import type { Metadata } from "next";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { listAccountProjects } from "@/src/lib/products/ownership";
import { listAccountWatchers, listAccountCommunities } from "@/src/lib/products/watch-runtime";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { WatchersListClient } from "@/src/components/watch/WatchersClient";

export const metadata: Metadata = { title: "Watchers — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function WatchersPage() {
  const { accountId, admin } = await requireWatchPage();
  const [watchers, communities, projects, shell] = await Promise.all([
    listAccountWatchers(admin, accountId),
    listAccountCommunities(admin, accountId),
    listAccountProjects(admin, accountId),
    getWatchShellContext(admin, accountId),
  ]);

  const deployments = communities.flatMap((c) =>
    c.watchers.map((w) => ({ watcherId: w.watcherId, communityTitle: c.title ?? c.chatId, enabled: w.enabled }))
  );

  return (
    <WatchShell active="watchers" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <WatchersListClient watchers={watchers} deployments={deployments} projects={projects} />
    </WatchShell>
  );
}
