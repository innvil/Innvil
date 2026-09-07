import type { Metadata } from "next";
import { requireWatchPage } from "@/src/lib/watch-page";
import { WatchersPageClient } from "@/src/components/watch/WatchersPageClient";

export const metadata: Metadata = { title: "Watchers — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

/** Cache-first navigation: this route only does the server-side auth/host
 *  gate (requireWatchPage) -- the real account data (Watchers/deployments/
 *  Projects/capacity) is fetched CLIENT-SIDE by WatchersPageClient via SWR,
 *  which renders from its cache instantly on every visit after the first
 *  and revalidates in the background. See app/watchers/[id]/page.tsx for the
 *  selected-Watcher counterpart -- both routes render the SAME navigator via
 *  the SAME shared client shell, never a separate list page. */
export default async function WatchersPage() {
  await requireWatchPage();
  return <WatchersPageClient />;
}
