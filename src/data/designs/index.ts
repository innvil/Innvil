import type { DesignMeta, DesignPackage } from "@/src/lib/design/schema";
import { PULSE } from "./pulse";
import { STUDIO } from "./studio";
import { AGENCY } from "./agency";
import { ORBIT } from "./orbit";

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
export const PUBLISHED_DESIGNS: DesignPackage[] = [PULSE, STUDIO, AGENCY, ORBIT];

/** Teaser-only entries. Distinct creative directions, in build order. (None right now —
 *  the initial four are all published. New directions live in memory:
 *  innvil-design-directions.) */
export const COMING_SOON_DESIGNS: DesignMeta[] = [];

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
