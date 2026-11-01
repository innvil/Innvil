import type {
  DesignPackage, DesignPage, DesignSection, DesignTokens,
} from "./schema";

/**
 * VISUAL EDITOR config model (Phase 1).
 *
 * The editor produces the SAME shape as a marketplace design — a set of typed
 * sections + tokens — so the ONE `DesignRenderer` renders it, and an owner-built
 * design is just another config the renderer reads. Presentation only: functional
 * sections stay wired to Innvil's real components at render time (via slots).
 *
 * Stored per panel in `panels.settings.design.editor`:
 *   { draft: EditorDesign, published: EditorDesign | null }
 * Pure/serialisable (schema types only) — safe on client and server.
 */

export interface EditorDesign {
  /** Global token overrides on top of the editor's neutral defaults. */
  tokens: Partial<DesignTokens>;
  /** The landing page the owner is composing. */
  page: DesignPage;
}

export interface EditorState {
  draft: EditorDesign;
  /** The published snapshot shown on the storefront (null = not published). */
  published: EditorDesign | null;
}

/** A clean, neutral dark palette — a blank canvas, deliberately unlike Pulse. */
export const EDITOR_DEFAULT_TOKENS: DesignTokens = {
  bg: "#0A0B0F",
  bgAlt: "#101218",
  surface: "#14161D",
  surfaceAlt: "#1B1E27",
  border: "#262A35",
  text: "#EDEAE2",
  textDim: "#9497A3",
  textFaint: "#5C5F6B",
  accent: "#C9A574",
  accentAlt: "#8B7FFF",
  backdrop: "none",
  fontDisplay: "var(--font-display), Georgia, serif",
  fontBody: "var(--font-sans), system-ui, sans-serif",
  radius: "12px",
  radiusLg: "20px",
  shadow: "0 20px 50px -20px rgba(0,0,0,0.6)",
  sectionY: "4.5rem",
};

/** The section kinds an owner can place from the component library. */
export const EDITOR_SECTION_KINDS = [
  "hero", "stats", "services", "platforms", "steps",
  "features", "testimonials", "faq", "cta", "content", "functional",
] as const;
export type EditorSectionKind = (typeof EDITOR_SECTION_KINDS)[number];

export const SECTION_LABELS: Record<EditorSectionKind, string> = {
  hero: "Hero",
  stats: "Stats bar",
  services: "Services",
  platforms: "Platforms",
  steps: "How it works",
  features: "Features",
  testimonials: "Testimonials",
  faq: "FAQ",
  cta: "Call to action",
  content: "Content block",
  functional: "Sign-up / functional",
};

let SEQ = 0;
function sid(kind: string): string {
  return `${kind}_${Date.now().toString(36)}_${SEQ++}`;
}

/** A valid section with sensible defaults for a freshly added block. */
export function makeSection(kind: EditorSectionKind): DesignSection {
  const base = { id: sid(kind), animation: "fade-up" as const };
  switch (kind) {
    case "hero":
      return {
        ...base, type: "hero", variant: "split-float", mockup: "phone-feed",
        eyebrow: "Instant social growth",
        headline: "Grow your audience", headlineAccent: "on autopilot.",
        sub: "Followers, likes and views — delivered fast, priced clearly, tracked in real time.",
        ctas: [{ label: "Get started", action: "signup" }, { label: "Browse services", action: "services" }],
        floats: [
          { kind: "like", label: "Likes", value: "+1.2K" },
          { kind: "follower", label: "Followers", value: "+840" },
        ],
      };
    case "stats":
      return {
        ...base, type: "stats", variant: "glass-row",
        items: [
          { label: "Services", value: "—", source: "live" },
          { label: "Platforms", value: "—", source: "live" },
          { label: "Starting from", value: "—", source: "live" },
          { label: "Support", value: "24/7" },
        ],
      };
    case "services":
      return { ...base, type: "services", variant: "glow-cards", heading: "Popular right now", sub: "Transparent pricing, instant start.", limit: 6, showPrices: true };
    case "platforms":
      return { ...base, type: "platforms", variant: "pill-cloud", heading: "Every platform you need", sub: "Pick a platform and see everything available." };
    case "steps":
      return {
        ...base, type: "steps", variant: "numbered-float", heading: "Three steps to growth",
        steps: [
          { title: "Create your account", body: "Sign up in seconds — no waiting." },
          { title: "Add funds", body: "Top up your wallet your way." },
          { title: "Order and watch", body: "Pick a service and track delivery live." },
        ],
      };
    case "features":
      return {
        ...base, type: "features", variant: "glass-grid", heading: "Built for people who post daily",
        items: [
          { title: "Instant start", body: "Most orders begin within minutes." },
          { title: "One wallet", body: "Fund once, order anything." },
          { title: "Live tracking", body: "Real progress on every order." },
        ],
      };
    case "testimonials":
      return {
        ...base, type: "testimonials", variant: "float-cards", heading: "Loved by creators",
        items: [
          { quote: "Delivery speed is unreal.", name: "Maya R.", role: "Creator", rating: 5 },
          { quote: "The only panel I trust for volume.", name: "Deniz K.", role: "Agency owner", rating: 5 },
        ],
      };
    case "faq":
      return {
        ...base, type: "faq", variant: "glass-accordion", heading: "Questions, answered",
        items: [
          { q: "How fast do orders start?", a: "Most services begin within a few minutes." },
          { q: "What if an order doesn't fully deliver?", a: "The undelivered portion is refunded to your wallet automatically." },
        ],
      };
    case "cta":
      return { ...base, type: "cta", variant: "gradient-band", heading: "Your next thousand followers start today.", sub: "Create an account and place your first order in minutes.", ctas: [{ label: "Get started free", action: "signup" }] };
    case "content":
      return { ...base, type: "content", heading: "A little about us", body: "Tell your customers what makes your panel different." };
    case "functional":
      return { ...base, type: "functional", component: "auth-card", variant: "glass-centered", heading: "Create your account", sub: "Takes less than a minute." };
  }
}

/** The design a brand-new editor starts from — a complete, sensible landing. */
export function starterDesign(): EditorDesign {
  return {
    tokens: {},
    page: {
      id: "landing",
      header: {
        variant: "floating-pill",
        sticky: true,
        links: [
          { label: "Services", href: "#services" },
          { label: "How it works", href: "#steps" },
          { label: "FAQ", href: "#faq" },
        ],
        ctas: [{ label: "Log in", action: "login" }, { label: "Get started", action: "signup" }],
      },
      sections: [
        makeSection("hero"),
        makeSection("stats"),
        makeSection("services"),
        makeSection("steps"),
        makeSection("features"),
        makeSection("faq"),
        makeSection("cta"),
      ],
      footer: { variant: "glass-columns", blurb: "Fast, transparent social growth — one wallet, every platform." },
    },
  };
}

function isEditorDesign(v: unknown): v is EditorDesign {
  return !!v && typeof v === "object" && "page" in v && !!(v as { page?: unknown }).page;
}

/** Read the editor state from panel settings, repairing/defaulting as needed. */
export function readEditorState(settings: unknown): EditorState {
  const empty: EditorState = { draft: starterDesign(), published: null };
  if (!settings || typeof settings !== "object") return empty;
  const design = (settings as Record<string, unknown>).design;
  if (!design || typeof design !== "object") return empty;
  const editor = (design as Record<string, unknown>).editor;
  if (!editor || typeof editor !== "object") return empty;
  const e = editor as Record<string, unknown>;
  return {
    draft: isEditorDesign(e.draft) ? e.draft : starterDesign(),
    published: isEditorDesign(e.published) ? e.published : null,
  };
}

/** Wrap an EditorDesign as a DesignPackage so the shared renderer can draw it. */
export function editorToPackage(design: EditorDesign, name: string): DesignPackage {
  const tokens: DesignTokens = { ...EDITOR_DEFAULT_TOKENS, ...design.tokens };
  return {
    meta: {
      id: "editor", name, tagline: "", description: "",
      price: 0, categories: [], includedPages: ["landing"], features: [],
      version: "1.0.0", changelog: [], publisher: name, updatedAt: new Date().toISOString().slice(0, 10),
      responsive: true, animated: true, status: "published",
      cover: { background: tokens.bg, accent: tokens.accent },
    },
    tokens,
    pages: [design.page],
    preview: {
      panelName: name,
      services: [
        { name: "Instagram Followers — HQ", platform: "instagram", price: "1.35", min: "100" },
        { name: "TikTok Views — Instant", platform: "tiktok", price: "0.42", min: "1000" },
        { name: "YouTube Likes — Real", platform: "youtube", price: "2.10", min: "50" },
      ],
      categories: ["Followers", "Likes", "Views"],
    },
  };
}
