/**
 * Single canonical source for Innvil Watch's own product metadata (title,
 * description, Open Graph, Twitter card). Every Watch route that needs
 * full SEO/link-preview metadata (the public landing at "/", and the four
 * shared auth pages) reads from THIS constant rather than hand-writing its
 * own copy — the root cause of the reported "watch.innvil.cloud previews
 * as generic Innvil SMM Panel copy" bug was exactly this kind of
 * per-route duplication: the auth pages' `generateMetadata()` only ever
 * set `icons`, so title/description/openGraph/twitter silently fell
 * through to the ROOT layout's SMM-panel copy on every Watch auth page,
 * and "/" itself never set a `twitter` override at all (so Twitter/X-style
 * unfurlers that prefer `twitter:*` tags over `og:*` also fell through).
 *
 * Kept intentionally separate from `src/lib/auth/product-brand.ts`'s
 * `AuthBrand` (visual/design-token presentation) — this is SEO/link-
 * preview metadata only, consumed by `generateMetadata()` functions, never
 * rendered React.
 */

export const WATCH_TITLE = "Innvil Watch — AI Virtual Moderators for Communities";
export const WATCH_DESCRIPTION =
  "Deploy AI-powered Watchers to moderate, protect, and operate your Telegram communities — automated moderation, activity monitoring, and community operations, grounded in your own project knowledge.";
export const WATCH_SITE_NAME = "Innvil Watch";
/** Best existing Watch-branded static asset usable as a link-preview image.
 *  There is no dedicated large (e.g. 1200x630) social card for Watch today
 *  — this is a small app-tile icon, not a proper OG image; flagged as a
 *  follow-up rather than generating placeholder art. */
export const WATCH_OG_IMAGE = "/watch/app-tile.svg";

/** Shared block for any Watch page's `generateMetadata()` that needs the
 *  full public/link-preview surface (title/description/openGraph/twitter),
 *  not just the favicon. `path` is the route path (e.g. "/", "/login"),
 *  used for `openGraph.url`. */
export function watchPageMetadata(path: string) {
  return {
    title: WATCH_TITLE,
    description: WATCH_DESCRIPTION,
    openGraph: {
      url: path,
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
