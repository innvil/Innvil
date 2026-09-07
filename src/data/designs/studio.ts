import type { DesignPackage } from "@/src/lib/design/schema";

/**
 * DESIGN #2 — "Studio"
 * Direction: dark creator-economy. Near-black cinematic canvas, cyan/electric accent,
 * bold editorial headlines, a creator-analytics card (mini growth chart + follower/
 * view/revenue stats) in the hero, glowing service cards. Deliberately unlike Pulse's
 * pink social-engagement look — a different composition, not a recolour.
 */
export const STUDIO: DesignPackage = {
  meta: {
    id: "studio",
    name: "Studio",
    tagline: "The creator economy, quantified.",
    description:
      "A dark, cinematic landing for panels selling to serious creators. An analytics card charts real growth in the hero, bold editorial type sets the tone, and glowing service cards make the catalog feel premium. Built to convert professionals who care about numbers.",
    price: 12,
    categories: ["creator-economy", "dark", "animated"],
    includedPages: ["landing", "login", "signup"],
    features: [
      "Creator-analytics hero card with growth chart",
      "Cinematic near-black canvas",
      "Bold editorial typography",
      "Glowing service cards",
      "Live catalog + count-up stats",
      "Testimonials + FAQ",
      "Desktop, tablet and mobile layouts",
    ],
    version: "1.0.0",
    changelog: [{ version: "1.0.0", date: "2026-07-24", notes: "Initial release." }],
    publisher: "Innvil Studio",
    updatedAt: "2026-07-24",
    responsive: true,
    animated: true,
    status: "published",
    cover: {
      background: "linear-gradient(160deg, #05070D 0%, #0B1220 55%, #07131A 100%)",
      accent: "#22D3EE",
    },
  },

  tokens: {
    bg: "#05070D",
    bgAlt: "#0A0E17",
    surface: "#0E141F",
    surfaceAlt: "#141C2A",
    border: "rgba(148,163,184,0.16)",
    text: "#F1F5F9",
    textDim: "rgba(226,232,240,0.68)",
    textFaint: "rgba(148,163,184,0.6)",
    accent: "#22D3EE",
    accentAlt: "#6366F1",
    backdrop: "radial-gradient(90% 60% at 80% -10%, rgba(34,211,238,0.16) 0%, rgba(99,102,241,0.10) 40%, rgba(5,7,13,0) 72%)",
    fontDisplay: "var(--font-display), 'Times New Roman', serif",
    fontBody: "var(--font-sans), system-ui, sans-serif",
    radius: "10px",
    radiusLg: "18px",
    shadow: "0 24px 60px -24px rgba(34,211,238,0.35)",
    sectionY: "6rem",
  },

  pages: [
    {
      id: "landing",
      header: {
        variant: "floating-pill",
        sticky: true,
        links: [
          { label: "Services", href: "#services" },
          { label: "How it works", href: "#steps" },
          { label: "Reviews", href: "#testimonials" },
          { label: "FAQ", href: "#faq" },
        ],
        ctas: [{ label: "Log in", action: "login" }, { label: "Start now", action: "signup" }],
      },
      sections: [
        {
          id: "hero",
          type: "hero",
          variant: "split-analytics",
          animation: "fade-up",
          eyebrow: "Built for creators",
          headline: "Grow the numbers",
          headlineAccent: "that pay you.",
          sub: "Followers, views and engagement that translate into reach and revenue — delivered fast and tracked like a pro.",
          ctas: [
            { label: "Start growing", action: "signup" },
            { label: "See services", action: "services" },
          ],
          floats: [
            { kind: "view", label: "Views", value: "1.2M" },
            { kind: "follower", label: "New followers", value: "+48K" },
          ],
          mockup: "dashboard-card",
        },
        {
          id: "stats",
          type: "stats",
          variant: "line-row",
          animation: "count-up",
          items: [
            { label: "Services", value: "—", source: "live" },
            { label: "Platforms", value: "—", source: "live" },
            { label: "Starting from", value: "—", source: "live" },
            { label: "Uptime", value: "99.9%" },
          ],
        },
        {
          id: "services",
          type: "services",
          variant: "glow-cards",
          animation: "fade-up",
          heading: "Services that move the needle",
          sub: "Transparent pricing. Instant start. Real delivery you can measure.",
          limit: 6,
          showPrices: true,
        },
        {
          id: "features",
          type: "features",
          variant: "glass-grid",
          animation: "fade-up",
          heading: "Run your growth like a business",
          items: [
            { title: "Measurable results", body: "Every order shows real progress — no black boxes." },
            { title: "Fast delivery", body: "Most services start within minutes of payment." },
            { title: "One balance", body: "Fund once, order across every platform." },
            { title: "Auto refunds", body: "Undelivered volume returns to your wallet automatically." },
            { title: "Creator support", body: "Real answers from a real support team." },
            { title: "Private by default", body: "Your campaigns and links stay yours." },
          ],
        },
        {
          id: "steps",
          type: "steps",
          variant: "numbered",
          animation: "fade-up",
          heading: "From zero to trending",
          steps: [
            { title: "Create your account", body: "No approval queue — you're in immediately." },
            { title: "Fund your balance", body: "Top up with your preferred method." },
            { title: "Launch and track", body: "Order a service and watch the metrics climb." },
          ],
        },
        {
          id: "testimonials",
          type: "testimonials",
          variant: "editorial",
          animation: "fade-up",
          heading: "Creators and agencies scale here",
          items: [
            { quote: "My last three videos hit the algorithm because the early numbers were there. This is my edge.", name: "Ravi N.", role: "YouTuber, 240K", rating: 5 },
            { quote: "We manage growth for a dozen clients. Volume, speed, transparency — it's the only panel we trust.", name: "Lena F.", role: "Agency founder", rating: 5 },
            { quote: "Clean dashboard, real delivery, fair prices. Exactly what a working creator needs.", name: "Marco T.", role: "Musician", rating: 5 },
          ],
        },
        {
          id: "auth",
          type: "functional",
          component: "auth-card",
          variant: "dark-centered",
          animation: "fade-up",
          heading: "Create your account",
          sub: "Start tracking growth in under a minute.",
        },
        {
          id: "faq",
          type: "faq",
          variant: "dark-accordion",
          heading: "Questions, answered",
          items: [
            { q: "How quickly do orders start?", a: "Most services begin within a few minutes. Each service shows its own estimated start time before you order." },
            { q: "What if delivery falls short?", a: "The undelivered portion is refunded to your wallet automatically — you only pay for what lands." },
            { q: "Do I fund before ordering?", a: "Yes. You top up once, then order as often as you like from that balance." },
            { q: "Is my data private?", a: "Your links and order history are visible only to you and the panel's support team." },
          ],
        },
        {
          id: "cta",
          type: "cta",
          variant: "spotlight",
          animation: "fade-up",
          heading: "Your next breakout starts with the numbers.",
          sub: "Create an account and place your first order in minutes.",
          ctas: [{ label: "Start free", action: "signup" }],
        },
      ],
      footer: {
        variant: "dark-columns",
        blurb: "Growth services for serious creators — measurable, fast, one balance for every platform.",
        columns: [
          { title: "Explore", links: [{ label: "Services", href: "#services" }, { label: "How it works", href: "#steps" }] },
          { title: "Account", links: [{ label: "Log in", href: "/login" }, { label: "Create account", href: "/signup" }] },
        ],
      },
    },
  ],

  preview: {
    panelName: "CreatorLab",
    services: [
      { name: "YouTube Views — High Retention", platform: "youtube", price: "1.80", min: "1000" },
      { name: "Instagram Followers — Creator", platform: "instagram", price: "1.45", min: "100" },
      { name: "TikTok Video Views", platform: "tiktok", price: "0.38", min: "1000" },
      { name: "Spotify Plays", platform: "spotify", price: "0.90", min: "1000" },
      { name: "YouTube Watch Hours", platform: "youtube", price: "9.50", min: "100" },
      { name: "X (Twitter) Followers", platform: "x", price: "2.20", min: "100" },
    ],
    categories: ["Views", "Followers", "Watch time", "Plays", "Engagement"],
  },
};
