import type { Metadata } from "next";
import { getUser } from "@/src/lib/auth";
import { PublicLanding } from "@/src/components/panels";
import { getPublicTopupTiers } from "@/src/lib/actions/platform-payments";
import { LandingJsonLd } from "./JsonLd";
import HomeClient from "./HomeClient";

// Homepage-only canonical + OG url (kept off the layout so storefronts don't inherit it).
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

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
  // Dev world-switcher harness.
  if (sp?.preview === "1") return <HomeClient mode="preview" />;

  const user = await getUser();
  if (user) return <HomeClient mode="app" />;

  // Public marketing page — server-rendered for search engines & first paint.
  return (
    <>
      <LandingJsonLd />
      <PublicLanding />
    </>
  );
}
