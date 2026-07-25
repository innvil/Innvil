import type { DesignMeta, DesignPackage } from "@/src/lib/design/schema";
import { PULSE } from "./pulse";

/**
 * DESIGN MARKETPLACE CATALOG.
 *
 * Deliberately shipped ONE DESIGN AT A TIME: a design only becomes `published`
 * (buyable + fully previewable) once it's finished end to end. Everything else is a
 * `coming_soon` teaser card — real metadata, no half-built package behind it.
 *
 * Each planned design is a genuinely different composition (hero, artwork, service
 * presentation, typography, animation), never the same layout recolored.
 */

/** Finished, buyable designs — each has a complete package + full live preview. */
export const PUBLISHED_DESIGNS: DesignPackage[] = [PULSE];

/** Teaser-only entries. Distinct creative directions, in build order. */
export const COMING_SOON_DESIGNS: DesignMeta[] = [
  {
    id: "studio",
    name: "Studio",
    tagline: "The creator economy, quantified.",
    description:
      "A dark, cinematic creator-economy landing: video statistics, engagement charts, glowing service cards and oversized editorial typography. Built for panels selling to serious creators.",
    price: 34,
    categories: ["creator-economy", "dark", "animated"],
    includedPages: ["landing", "login", "signup"],
    features: ["Engagement chart hero", "Glowing service cards", "Video stat blocks", "Bold editorial type"],
    version: "0.9.0",
    changelog: [],
    publisher: "Innvil Studio",
    updatedAt: "2026-07-24",
    responsive: true,
    animated: true,
    status: "coming_soon",
    cover: { background: "linear-gradient(160deg, #05070D 0%, #0B1220 55%, #07131A 100%)", accent: "#22D3EE" },
  },
  {
    id: "agency",
    name: "Agency",
    tagline: "Campaign-grade credibility.",
    description:
      "A clean agency composition: campaign dashboards, client metrics, side-by-side service comparisons, testimonials and polished product mockups. For panels selling to businesses.",
    price: 34,
    categories: ["agency", "corporate", "conversion"],
    includedPages: ["landing", "login", "signup", "pricing"],
    features: ["Campaign dashboard mockup", "Client metric bands", "Service comparison table", "Case-study testimonials"],
    version: "0.8.0",
    changelog: [],
    publisher: "Innvil Studio",
    updatedAt: "2026-07-24",
    responsive: true,
    animated: false,
    status: "coming_soon",
    cover: { background: "linear-gradient(150deg, #F8FAFC 0%, #E2E8F0 60%, #CBD5E1 100%)", accent: "#1D4ED8" },
  },
  {
    id: "orbit",
    name: "Orbit",
    tagline: "Minimal, fast, futuristic.",
    description:
      "A restrained futuristic landing: generous whitespace, monospace accents, orbiting platform glyphs and micro-interactions. For panels that want to feel like a product, not a storefront.",
    price: 29,
    categories: ["minimal", "futuristic", "platform-focused"],
    includedPages: ["landing", "login", "signup"],
    features: ["Orbiting platform glyphs", "Monospace detailing", "Micro-interactions", "Ultra-light layout"],
    version: "0.7.0",
    changelog: [],
    publisher: "Innvil Studio",
    updatedAt: "2026-07-24",
    responsive: true,
    animated: true,
    status: "coming_soon",
    cover: { background: "linear-gradient(200deg, #0A0A0B 0%, #16181D 60%, #0A0A0B 100%)", accent: "#A3E635" },
  },
];

/** All marketplace cards (published first, then teasers). */
export function designCards(): DesignMeta[] {
  return [...PUBLISHED_DESIGNS.map((d) => d.meta), ...COMING_SOON_DESIGNS];
}

/** A buyable/previewable package by id (teasers return undefined by design). */
export function getDesignPackage(id: string): DesignPackage | undefined {
  return PUBLISHED_DESIGNS.find((d) => d.meta.id === id);
}

export function getDesignMeta(id: string): DesignMeta | undefined {
  return designCards().find((m) => m.id === id);
}
