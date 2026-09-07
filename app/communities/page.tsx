import type { Metadata } from "next";
import { requireWatchPage } from "@/src/lib/watch-page";
import { CommunitiesPageClient } from "@/src/components/watch/CommunitiesPageClient";

export const metadata: Metadata = { title: "Communities — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

/** Cache-first navigation: this route only does the server-side auth/host
 *  gate (requireWatchPage) -- the real account data (Communities/capacity/
 *  expansion state/gateways) is fetched CLIENT-SIDE by CommunitiesPageClient
 *  via SWR, which renders from its cache instantly on every visit after the
 *  first and revalidates in the background. */
export default async function CommunitiesPage() {
  await requireWatchPage();
  return <CommunitiesPageClient />;
}
