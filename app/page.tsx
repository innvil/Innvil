import type { Metadata } from "next";
import { getUser } from "@/src/lib/auth";
import { PublicLanding } from "@/src/components/panels/PublicLanding";
import { getPublicTopupTiers } from "@/src/lib/actions/platform-payments";
import { LandingJsonLd } from "./JsonLd";
import HomeClient from "./HomeClient";
import { isWatchHost } from "@/src/lib/watch-host";
import { watchPageMetadata } from "@/src/lib/watch-metadata";
import { WatchLanding } from "@/src/components/watch/WatchLanding";
import { WatchDashboard } from "@/src/components/watch/WatchDashboard";
import { getWatchAccessState } from "@/src/lib/actions/watch-dashboard";

// Homepage-only canonical + OG url (kept off the layout so storefronts don't inherit it).
// Host-aware: watch.innvil.cloud gets its own product metadata, never the
// inherited SMM-panel/Forge title+description.
export async function generateMetadata(): Promise<Metadata> {
  if (await isWatchHost()) {
    return {
      ...watchPageMetadata("/"),
      alternates: { canonical: "/" },
      robots: { index: true, follow: true },
      icons: { icon: "/watch/app-tile.svg" },
    };
  }
  return {
    alternates: { canonical: "/" },
    openGraph: { url: "/" },
  };
}

/* =========================================================
   ROOT — SEO-friendly.
   Signed-out visitors get the marketing landing SERVER-RENDERED (crawlable).
   Signed-in users and the dev preview switcher render client-side via HomeClient.
   Auth lives at real routes (/login, /signup), so the landing needs no client
   state to work.
   ========================================================= */

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // Innvil Watch's own standalone product domain — a distinct customer-facing
  // experience, never the SMM-panel/Forge landing, but the SAME app/backend
  // (host is presentation-only; Watch access is always resolved server-side).
  if (await isWatchHost()) {
    const access = await getWatchAccessState();
    // AUTHENTICATION != ENTITLEMENT -- any signed-in visitor gets the real
    // dashboard shell (empty/onboarding states for a fresh, not-yet-entitled
    // account, per getWatchAccessState's own doc comment), never the
    // marketing landing just because they haven't started a trial/subscribed
    // yet. Only a genuinely unauthenticated visitor sees WatchLanding.
    if (access.authenticated) {
      return (
        <WatchDashboard
          projects={access.projects}
          watchers={access.watchers}
          communities={access.communities}
          capacity={access.capacity}
          activity={access.activity}
          moderationActionsLast7Days={access.moderationActionsLast7Days}
          attentionItems={access.attentionItems}
          communityStats={access.communityStats}
        />
      );
    }
    return <WatchLanding authenticated={access.authenticated} />;
  }

  // Dev world-switcher harness.
  if (sp?.preview === "1") return <HomeClient mode="preview" />;

  const user = await getUser();
  if (user) return <HomeClient mode="app" />;

  // Public marketing page — server-rendered for search engines & first paint.
  const topupTiers = await getPublicTopupTiers();
  return (
    <>
      <LandingJsonLd />
      <PublicLanding topupTiers={topupTiers} />
    </>
  );
}
