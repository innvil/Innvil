import type { DesignPackage } from "@/src/lib/design/schema";
import type { PlatformFocus } from "@/src/lib/platform-focus";

/* =========================================================
   Platform content packs + overlay.
   A platform-focused panel (e.g. Telegram-only) overlays a platform content pack onto
   whatever landing is active — the default landing OR a purchased design. The design
   keeps its LOOK (tokens, layout, animation); the pack supplies the WORDS. So "Pulse on
   a Telegram panel" reads as a Telegram growth service, not a generic SMM landing.
   Pure/serializable — safe on client or server.
   ========================================================= */

export type HeroFloatKind = "like" | "heart" | "view" | "follower" | "comment" | "share" | "notify";

export interface PlatformContentPack {
  key: string;
  label: string;
  /** Default (non-design) landing hero copy. */
  landing: { headline: string; description: string };
  hero: {
    eyebrow: string;
    headline: string;
    headlineAccent?: string;
    sub: string;
    floats?: Array<{ kind: HeroFloatKind; label?: string; value?: string }>;
  };
  services?: { heading?: string; sub?: string };
  platforms?: { heading?: string; sub?: string };
  features: { heading?: string; items: Array<{ title: string; body: string; icon?: string }> };
  steps: { heading?: string; items: Array<{ title: string; body: string }> };
  testimonials?: { heading?: string; items: Array<{ quote: string; name: string; role?: string }> };
  faq: { heading?: string; items: Array<{ q: string; a: string }> };
  cta: { heading: string; sub?: string };
  seo: { title: string; description: string };
}

// Registry — grows one platform at a time (lazy-free: static import is fine, packs are tiny).
import { TELEGRAM_CONTENT } from "@/src/data/platform-content/telegram";

const PACKS: Record<PlatformFocus, PlatformContentPack> = {
  telegram: TELEGRAM_CONTENT,
};

export function getPlatformContentPack(focus: PlatformFocus | null): PlatformContentPack | null {
  return focus ? PACKS[focus] ?? null : null;
}

/**
 * Return a copy of `pkg` with the LANDING page's text overridden from the platform pack.
 * Tokens, section variants, animations, functional slots and the services section's live
 * data are all preserved — only copy is swapped.
 */
export function applyPlatformContent(pkg: DesignPackage, focus: PlatformFocus | null): DesignPackage {
  const pack = getPlatformContentPack(focus);
  if (!pack) return pkg;

  const clone: DesignPackage = JSON.parse(JSON.stringify(pkg));
  const page = clone.pages?.find((p) => p.id === "landing");
  if (!page?.sections) return clone;

  for (const section of page.sections) {
    switch (section.type) {
      case "hero":
        section.eyebrow = pack.hero.eyebrow;
        section.headline = pack.hero.headline;
        if (pack.hero.headlineAccent !== undefined) section.headlineAccent = pack.hero.headlineAccent;
        section.sub = pack.hero.sub;
        if (pack.hero.floats && section.floats) section.floats = pack.hero.floats;
        break;
      case "services":
        if (pack.services?.heading) section.heading = pack.services.heading;
        if (pack.services?.sub) section.sub = pack.services.sub;
        break;
      case "platforms":
        if (pack.platforms?.heading) section.heading = pack.platforms.heading;
        if (pack.platforms?.sub) section.sub = pack.platforms.sub;
        break;
      case "features":
        if (pack.features.heading) section.heading = pack.features.heading;
        section.items = pack.features.items;
        break;
      case "steps":
        if (pack.steps.heading) section.heading = pack.steps.heading;
        section.steps = pack.steps.items;
        break;
      case "testimonials":
        if (pack.testimonials) {
          if (pack.testimonials.heading) section.heading = pack.testimonials.heading;
          section.items = pack.testimonials.items;
        }
        break;
      case "faq":
        if (pack.faq.heading) section.heading = pack.faq.heading;
        section.items = pack.faq.items;
        break;
      case "cta":
        section.heading = pack.cta.heading;
        if (pack.cta.sub) section.sub = pack.cta.sub;
        break;
      default:
        break;
    }
  }
  return clone;
}
