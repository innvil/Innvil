/**
 * Single canonical source for Innvil Watch's own product metadata (title,
 * description, keywords, canonical URL, Open Graph, Twitter card). Every
 * Watch route that needs full SEO/link-preview metadata (the public
 * landing at "/", and the four shared auth pages) reads from THIS
 * constant/function rather than hand-writing its own copy — the root
 * cause of the reported "watch.innvil.cloud previews as generic Innvil SMM
 * Panel copy" bug was exactly this kind of per-route duplication: the auth
 * pages' `generateMetadata()` only ever set `icons`, so title/description/
 * openGraph/twitter silently fell through to the ROOT layout's SMM-panel
 * copy on every Watch auth page, and "/" itself never set a `twitter`
 * override at all (so Twitter/X-style unfurlers that prefer `twitter:*`
 * tags over `og:*` also fell through).
 *
 * REVISED (2026-08-29) — two more real, related bugs found and fixed:
 * (1) `openGraph.url`/`alternates.canonical` were RELATIVE paths (e.g. "/",
 * "/login"), which Next.js resolves against the root layout's
 * `metadataBase` (`NEXT_PUBLIC_APP_URL`, the MAIN Innvil site's own origin,
 * never watch.innvil.cloud) — so the canonical URL and og:url for every
 * Watch page were silently pointing at the main Innvil domain instead of
 * the actual Watch domain. Fixed by building a real ABSOLUTE URL from
 * `WATCH_ROOT_DOMAIN` here, independent of whatever `metadataBase` the
 * root layout happens to be configured with.
 * (2) `keywords` was never set here at all — Next.js metadata merging
 * inherits any field a `generateMetadata()` doesn't explicitly set from
 * the layout above it, so every Watch page was silently inheriting the
 * root layout's own `keywords` array (app/layout.tsx), which is 100%
 * unrelated SMM-panel-builder terms. Fixed by setting a real, Watch/
 * Telegram-specific `keywords` array here, which now overrides it.
 *
 * Kept intentionally separate from `src/lib/auth/product-brand.ts`'s
 * `AuthBrand` (visual/design-token presentation) — this is SEO/link-
 * preview metadata only, consumed by `generateMetadata()` functions, never
 * rendered React.
 */

import { WATCH_ROOT_DOMAIN } from "./config";

export const WATCH_TITLE = "Innvil Watch — AI Virtual Moderators for Telegram";
export const WATCH_DESCRIPTION =
  "Deploy AI-powered Watchers that participate in Telegram conversations, moderate spam and scams, answer from your Project Knowledge, and help operate your community 24/7.";
export const WATCH_SITE_NAME = "Innvil Watch";
/** Best existing Watch-branded static asset usable as a link-preview image.
 *  There is no dedicated large (e.g. 1200x630) social card for Watch today
 *  — this is a small app-tile icon, not a proper OG image; flagged as a
 *  follow-up rather than generating placeholder art. */
export const WATCH_OG_IMAGE = "/watch/app-tile.svg";

/** The real, public origin for Innvil Watch — never derived from
 *  `NEXT_PUBLIC_APP_URL`/`metadataBase`, which point at the main Innvil
 *  site. Used to build absolute canonical/og:url values so they can never
 *  silently resolve against the wrong domain. */
export const WATCH_BASE_URL = `https://${WATCH_ROOT_DOMAIN}`;

/** Real, Telegram/community-moderation-specific search terms — deliberately
 *  contains nothing about SMM panels, resellers, or panel software, since
 *  none of that describes this product. */
export const WATCH_KEYWORDS = [
  "ai telegram moderator",
  "telegram moderation bot",
  "virtual moderator for telegram",
  "ai community moderator",
  "telegram community management",
  "telegram spam and scam protection",
  "crypto community moderation bot",
  "telegram moderator bot with ai",
];

/** Shared block for any Watch page's `generateMetadata()` that needs the
 *  full public/link-preview surface (title/description/keywords/canonical/
 *  openGraph/twitter), not just the favicon. `path` is the route path
 *  (e.g. "/", "/login"), used to build the real absolute canonical/og:url
 *  for that exact route. */
export function watchPageMetadata(path: string) {
  const url = `${WATCH_BASE_URL}${path}`;
  return {
    title: WATCH_TITLE,
    description: WATCH_DESCRIPTION,
    keywords: WATCH_KEYWORDS,
    alternates: { canonical: url },
    openGraph: {
      url,
      title: WATCH_TITLE,
      description: WATCH_DESCRIPTION,
      siteName: WATCH_SITE_NAME,
      type: "website" as const,
      images: [{ url: WATCH_OG_IMAGE }],
    },
    twitter: {
      card: "summary" as const,
      title: WATCH_TITLE,
      description: WATCH_DESCRIPTION,
      images: [WATCH_OG_IMAGE],
    },
  };
}
