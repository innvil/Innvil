import Link from "next/link";
import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { listAccountCommunities, getCommunityOperationalStats, communityOperationalStatus, type CommunityOperationalStatus } from "@/src/lib/products/watch-runtime";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { EmptyRow, OperationalStatusBadge, relTime, WatcherNamesCell } from "@/src/components/watch/WatchUI";

export const metadata: Metadata = { title: "Communities — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

const STATUS_FILTERS: Array<{ value: CommunityOperationalStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "healthy", label: "Healthy" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "paused", label: "Paused" },
];

export default async function CommunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const { accountId, admin } = await requireWatchPage();
  const [communities, statsMap, shell] = await Promise.all([
    listAccountCommunities(admin, accountId),
    getCommunityOperationalStats(admin, accountId),
    getWatchShellContext(admin, accountId),
  ]);

  const filtered = status ? communities.filter((c) => communityOperationalStatus(c) === status) : communities;

  return (
    <WatchShell active="communities" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="w-display text-xl mb-1">Communities</h1>
            <p className="text-sm w-text-dim">Every Telegram community connected across your Projects.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.value || "all"}
                href={f.value ? `/communities?status=${f.value}` : "/communities"}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${(status ?? "") === f.value ? "w-teal-border w-teal" : "w-line-soft w-text-dim hover:w-text"}`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>

        {communities.length === 0 ? (
          <div className="w-card p-10 text-center">
            <Users size={28} className="w-teal mx-auto mb-3" />
            <EmptyRow text="No Communities connected yet." />
            <p className="text-xs w-text-faint">
              Connect one from a deployable Watcher on the{" "}
              <Link href="/watchers" className="w-teal hover:underline">Watchers page</Link>.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="w-card p-10 text-center"><EmptyRow text="No Communities match this filter." /></div>
        ) : (
          <div className="w-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold py-3 px-4">Community</th>
                    <th className="font-semibold py-3 px-4">Project</th>
                    <th className="font-semibold py-3 px-4">Platform</th>
                    <th className="font-semibold py-3 px-4">Health</th>
                    <th className="font-semibold py-3 px-4">Watchers</th>
                    <th className="font-semibold py-3 px-4">Last activity</th>
                    <th className="font-semibold py-3 px-4">Moderation (24h)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const stats = statsMap.get(c.id);
                    return (
                      <tr key={c.id} className="border-t w-line-soft">
                        <td className="py-3 px-4"><Link href={`/communities/${c.id}`} className="w-text hover:w-teal font-medium">{c.title ?? c.chatId}</Link></td>
                        <td className="py-3 px-4"><Link href={`/projects/${c.projectId}`} className="w-text-dim hover:w-text">{c.projectName}</Link></td>
                        <td className="py-3 px-4 w-text-dim capitalize">{c.platform}</td>
                        <td className="py-3 px-4"><OperationalStatusBadge status={communityOperationalStatus(c)} /></td>
                        <td className="py-3 px-4 text-xs"><WatcherNamesCell watchers={c.watchers} /></td>
                        <td className="py-3 px-4 w-text-dim">{stats?.lastActivityAt ? relTime(stats.lastActivityAt) : "—"}</td>
                        <td className="py-3 px-4 w-text-dim">{stats?.moderationCount24h ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </WatchShell>
  );
}
