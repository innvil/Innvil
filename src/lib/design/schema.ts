/**
 * DESIGN PACKAGE SCHEMA — the shared, config-driven contract behind BOTH:
 *   1. the marketplace's complete one-time-purchase landing designs, and
 *   2. (later) the visual interface editor, which produces this same shape.
 *
 * A design package controls PRESENTATION ONLY. Functional pieces (auth, services,
 * orders, payments) are referenced by id and rendered by Innvil's real components,
 * so the backend/DB/API behaviour is never replaced by a design.
 *
 * Pure data + types (no React, no server imports) so it's safe everywhere.
 */

/* ---------------------------------------------------------------- tokens ---- */

/** Global design tokens. Rendered as CSS variables on the design root. */
export interface DesignTokens {
  /** Core palette. */
  bg: string;
  bgAlt: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentAlt: string;
  /** Optional decorative background (CSS gradient/image value). */
  backdrop?: string;
  /** Typography. */
  fontDisplay: string;
  fontBody: string;
  /** Shape + depth. */
  radius: string;
  radiusLg: string;
  shadow: string;
  /** Rhythm. */
  sectionY: string;
}

export const DESIGN_TOKEN_VARS: Record<keyof DesignTokens, string> = {
  bg: "--d-bg",
  bgAlt: "--d-bg-alt",
  surface: "--d-surface",
  surfaceAlt: "--d-surface-alt",
  border: "--d-border",
  text: "--d-text",
  textDim: "--d-text-dim",
  textFaint: "--d-text-faint",
  accent: "--d-accent",
  accentAlt: "--d-accent-alt",
  backdrop: "--d-backdrop",
  fontDisplay: "--d-font-display",
  fontBody: "--d-font-body",
  radius: "--d-radius",
  radiusLg: "--d-radius-lg",
  shadow: "--d-shadow",
  sectionY: "--d-section-y",
};

/** Token map → inline CSS custom properties for the design root. */
export function tokensToCssVars(t: DesignTokens, overrides?: Partial<DesignTokens>): Record<string, string> {
  const merged = { ...t, ...(overrides ?? {}) };
  const out: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(DESIGN_TOKEN_VARS)) {
    const value = merged[key as keyof DesignTokens];
    if (typeof value === "string" && value) out[cssVar] = value;
  }
  return out;
}

/* -------------------------------------------------------------- sections ---- */

/** Responsive visibility + spacing overrides for a section. */
export interface ResponsiveRules {
  hideDesktop?: boolean;
  hideTablet?: boolean;
  hideMobile?: boolean;
}

export type AnimationKind = "none" | "fade-up" | "fade-in" | "float" | "count-up";

export interface SectionBase {
  id: string;
  /** Layout variant for this section type (each type defines its own set). */
  variant?: string;
  animation?: AnimationKind;
  responsive?: ResponsiveRules;
  /** Per-section token overrides (e.g. an inverted band). */
  tokens?: Partial<DesignTokens>;
}

/** A call-to-action button. `action` keeps it wired to real behaviour. */
export interface DesignCta {
  label: string;
  /** signup | login | services | href — never arbitrary JS. */
  action: "signup" | "login" | "services" | "href";
  href?: string;
}

/** HERO — the headline composition. */
export interface HeroSection extends SectionBase {
  type: "hero";
  eyebrow?: string;
  headline: string;
  headlineAccent?: string;
  sub?: string;
  ctas?: DesignCta[];
  /** Decorative floating engagement elements (likes/views/followers…). */
  floats?: Array<{ kind: "like" | "heart" | "view" | "follower" | "comment" | "share" | "notify"; label?: string; value?: string }>;
  /** Optional phone/app mockup composition. */
  mockup?: "none" | "phone-feed" | "phone-orders" | "dashboard-card" | "collage" | "orbit";
}

/** STATS / trust numbers. */
export interface StatsSection extends SectionBase {
  type: "stats";
  heading?: string;
  /** `source: "live"` pulls real catalog-derived numbers where available. */
  items: Array<{ label: string; value: string; source?: "live" | "static" }>;
}

/** SERVICES — presentation of the panel's real catalog. */
export interface ServicesSection extends SectionBase {
  type: "services";
  heading?: string;
  sub?: string;
  /** How many to show (0 = all available). */
  limit?: number;
  showPrices?: boolean;
}

/** PLATFORMS — the platform/category strip. */
export interface PlatformsSection extends SectionBase {
  type: "platforms";
  heading?: string;
  sub?: string;
}

/** STEPS — how it works. */
export interface StepsSection extends SectionBase {
  type: "steps";
  heading?: string;
  steps: Array<{ title: string; body: string }>;
}

/** FEATURES / benefits grid. */
export interface FeaturesSection extends SectionBase {
  type: "features";
  heading?: string;
  sub?: string;
  items: Array<{ title: string; body: string; icon?: string }>;
}

/** TESTIMONIALS. */
export interface TestimonialsSection extends SectionBase {
  type: "testimonials";
  heading?: string;
  items: Array<{ quote: string; name: string; role?: string; rating?: number }>;
}

/** FAQ accordion. */
export interface FaqSection extends SectionBase {
  type: "faq";
  heading?: string;
  items: Array<{ q: string; a: string }>;
}

/** CTA band. */
export interface CtaSection extends SectionBase {
  type: "cta";
  heading: string;
  sub?: string;
  ctas?: DesignCta[];
}

/** FUNCTIONAL slot — rendered by Innvil's real component, styled by the design.
 *  This is how a design can place the auth card / order form without owning the logic. */
export interface FunctionalSection extends SectionBase {
  type: "functional";
  /** Which real component to mount. Constrained set = safe by construction. */
  component: "auth-card" | "service-list" | "payment-methods";
  heading?: string;
  sub?: string;
}

/** Free-form owner content (safe, structured). */
export interface ContentSection extends SectionBase {
  type: "content";
  heading?: string;
  body?: string;
  cta?: DesignCta;
}

export type DesignSection =
  | HeroSection | StatsSection | ServicesSection | PlatformsSection | StepsSection
  | FeaturesSection | TestimonialsSection | FaqSection | CtaSection | FunctionalSection | ContentSection;

/* ----------------------------------------------------------------- pages ---- */

export type DesignPageId = "landing" | "login" | "signup" | "services" | "pricing";

export interface DesignPage {
  id: DesignPageId;
  header?: { variant?: string; sticky?: boolean; links?: Array<{ label: string; href: string }>; ctas?: DesignCta[] };
  sections: DesignSection[];
  footer?: { variant?: string; blurb?: string; columns?: Array<{ title: string; links: Array<{ label: string; href: string }> }> };
}

/* -------------------------------------------------------------- package ---- */

export type DesignStyleCategory =
  | "social-growth" | "creator-economy" | "dark" | "minimal" | "agency"
  | "futuristic" | "corporate" | "colorful" | "platform-focused" | "animated" | "conversion";

/** Marketplace + lifecycle metadata. */
export interface DesignMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** One-time price in USD. */
  price: number;
  categories: DesignStyleCategory[];
  includedPages: DesignPageId[];
  features: string[];
  version: string;
  changelog: Array<{ version: string; date: string; notes: string }>;
  publisher: string;
  updatedAt: string;
  responsive: boolean;
  animated: boolean;
  /** published = buyable + previewable; coming_soon = teaser card only. */
  status: "published" | "coming_soon";
  /** Cover art (CSS gradient stack is fine — no external asset needed). */
  cover: { background: string; accent: string };
}

/** A complete design package: metadata + tokens + pages (+ preview content). */
export interface DesignPackage {
  meta: DesignMeta;
  tokens: DesignTokens;
  pages: DesignPage[];
  /** Demo content used by the full live preview (never the owner's real data). */
  preview: {
    panelName: string;
    services: Array<{ name: string; platform: string; price: string; min: string }>;
    categories: string[];
  };
}

/** Temporary, preview-only personalization (must never install/unlock a design). */
export interface PreviewPersonalization {
  panelName?: string;
  logoUrl?: string;
  accent?: string;
  mode?: "dark" | "light";
}

export function getPage(pkg: DesignPackage, id: DesignPageId): DesignPage | undefined {
  return pkg.pages.find((p) => p.id === id);
}

/** Apply preview personalization to tokens (accent only — never structural). */
export function personalizeTokens(t: DesignTokens, p?: PreviewPersonalization): DesignTokens {
  if (!p?.accent) return t;
  return { ...t, accent: p.accent, accentAlt: p.accent };
}
