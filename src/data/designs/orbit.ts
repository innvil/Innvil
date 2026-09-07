import type { DesignPackage } from "@/src/lib/design/schema";

/**
 * DESIGN #4 — "Orbit"
 * Direction: minimal futuristic premium — a combination of GlassOS (glass cards +
 * aurora), Neon-Cyber (subtle grid + electric accent) and the Floating Social
 * Ecosystem (platform badges orbiting a central dashboard node). Deep-space canvas,
 * electric-lime accent, monospace-ish detailing. A signature "orbit" hero layout,
 * distinct from Pulse / Studio / Agency.
 */
export const ORBIT: DesignPackage = {
  meta: {
    id: "orbit",
    name: "Orbit",
    tagline: "Every platform, in orbit.",
    description:
      "A minimal, futuristic, premium landing: a central dashboard node with your platforms orbiting it, glass cards, an aurora-over-grid backdrop and electric accents. Feels like a modern SaaS product, not a storefront — for panels that want to look like the future.",
    price: 7,
    categories: ["minimal", "futuristic", "platform-focused", "animated"],
    includedPages: ["landing", "login", "signup"],
    features: [
      "Orbiting platform-ecosystem hero",
      "Aurora-over-grid backdrop",
      "Glass cards + electric accent",
      "Animated rings + drifting badges",
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
      background: "linear-gradient(160deg, #07070E 0%, #0C0B1F 55%, #0A0A0B 100%)",
      accent: "#A3E635",
    },
  },

  tokens: {
    bg: "#07070E",
    bgAlt: "#0B0B16",
    surface: "rgba(255,255,255,0.05)",
    surfaceAlt: "rgba(255,255,255,0.09)",
    border: "rgba(163,230,53,0.20)",
    text: "#F4F6F0",
    textDim: "rgba(226,232,220,0.66)",
    textFaint: "rgba(148,163,140,0.6)",
    accent: "#A3E635",
    accentAlt: "#6366F1",
    // Aurora glow layered over a faint grid.
    backdrop:
      "radial-gradient(70% 55% at 78% -10%, rgba(163,230,53,0.14) 0%, rgba(99,102,241,0.12) 42%, rgba(7,7,14,0) 72%), repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 46px), repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 46px)",
    fontDisplay: "var(--font-sans), 'Space Grotesk', system-ui, sans-serif",
    fontBody: "var(--font-sans), system-ui, sans-serif",
    radius: "10px",
    radiusLg: "18px",
    shadow: "0 24px 60px -26px rgba(163,230,53,0.30)",
    sectionY: "6rem",
  },

  pages: [
    {
      id: "landing",
      header: {
        variant: "glass-pill",
        sticky: true,
        links: [
          { label: "Services", href: "#services" },
          { label: "How it works", href: "#steps" },
          { label: "Reviews", href: "#testimonials" },
          { label: "FAQ", href: "#faq" },
        ],
        ctas: [{ label: "Log in", action: "login" }, { label: "Launch", action: "signup" }],
      },
      sections: [
        {
          id: "hero",
          type: "hero",
          variant: "split-orbit",
          animation: "fade-up",
          eyebrow: "The modern SMM panel",
          headline: "Every platform,",
          headlineAccent: "in one orbit.",
          sub: "Followers, views and engagement across every network — delivered fast and tracked in real time from a single, beautifully simple dashboard.",
          ctas: [
            { label: "Launch your growth", action: "signup" },
            { label: "Explore services", action: "services" },
          ],
          mockup: "orbit",
        },
        {
          id: "stats",
          type: "stats",
          variant: "glass-row",
          animation: "count-up",
          items: [
            { label: "Services", value: "—", source: "live" },
            { label: "Platforms", value: "—", source: "live" },
            { label: "Starting from", value: "—", source: "live" },
            { label: "Uptime", value: "99.9%" },
          ],
        },
        {
          id: "features",
          type: "features",
          variant: "glass-grid",
          animation: "fade-up",
          heading: "Engineered to feel effortless",
          items: [
            { title: "Instant start", body: "Most orders begin within minutes of payment.", icon: "⚡" },
            { title: "One dashboard", body: "Every platform and order in a single clean view.", icon: "🛰️" },
            { title: "Live tracking", body: "Real-time progress on every order — no guessing.", icon: "📡" },
            { title: "Auto refunds", body: "Undelivered volume returns to your wallet automatically.", icon: "↩️" },
            { title: "Developer API", body: "Wire growth into your own tools with a clean API.", icon: "🧩" },
            { title: "Private by default", body: "Your links and orders stay yours. Always.", icon: "🔒" },
          ],
        },
        {
          id: "services",
          type: "services",
          variant: "glow-cards",
          animation: "fade-up",
          heading: "Services in orbit",
          sub: "Transparent pricing, instant start, delivery you can watch.",
          limit: 6,
          showPrices: true,
        },
        {
          id: "steps",
          type: "steps",
          variant: "numbered",
          animation: "fade-up",
          heading: "Launch in three steps",
          steps: [
            { title: "Create your account", body: "Sign up in seconds — no waiting." },
            { title: "Fund your wallet", body: "Top up once with your preferred method." },
            { title: "Order & track", body: "Pick a service and watch it climb, live." },
          ],
        },
        {
          id: "testimonials",
          type: "testimonials",
          variant: "glass-quotes",
          animation: "fade-up",
          heading: "Built for people who ship",
          items: [
            { quote: "It finally feels like a real product, not a spreadsheet with a login.", name: "Ivo R.", role: "Creator", rating: 5 },
            { quote: "Fast, clean, and the API dropped straight into our stack. Perfect.", name: "Nadia H.", role: "Growth engineer", rating: 5 },
            { quote: "The dashboard alone sold me. Everything just makes sense.", name: "Owen D.", role: "Reseller", rating: 5 },
          ],
        },
        {
          id: "auth",
          type: "functional",
          component: "auth-card",
          variant: "glass-centered",
          animation: "fade-up",
          heading: "Create your account",
          sub: "Launch your growth in under a minute.",
        },
        {
          id: "faq",
          type: "faq",
          variant: "glass-accordion",
          heading: "Questions, answered",
          items: [
            { q: "How fast do orders start?", a: "Most services begin within a few minutes. Each service shows its own estimated start time before you order." },
            { q: "What if an order doesn't fully deliver?", a: "The undelivered portion is refunded to your wallet automatically — you only pay for what lands." },
            { q: "Is there an API?", a: "Yes — a clean API lets you place and track orders from your own tools." },
            { q: "Is my data private?", a: "Your links and order history are visible only to you and the panel's support team." },
          ],
        },
        {
          id: "cta",
          type: "cta",
          variant: "aurora-band",
          animation: "fade-up",
          heading: "Put your growth into orbit.",
          sub: "Create an account and place your first order in minutes.",
          ctas: [{ label: "Launch free", action: "signup" }],
        },
      ],
      footer: {
        variant: "glass-columns",
        blurb: "A modern, minimal SMM panel — every platform in one orbit, delivered fast.",
        columns: [
          { title: "Explore", links: [{ label: "Services", href: "#services" }, { label: "How it works", href: "#steps" }] },
          { title: "Account", links: [{ label: "Log in", href: "/login" }, { label: "Create account", href: "/signup" }] },
        ],
      },
    },
  ],

  preview: {
    panelName: "Orbital",
    services: [
      { name: "Instagram Followers — HQ", platform: "instagram", price: "1.30", min: "100" },
      { name: "TikTok Views — Instant", platform: "tiktok", price: "0.36", min: "1000" },
      { name: "YouTube Views — HR", platform: "youtube", price: "1.75", min: "1000" },
      { name: "Telegram Members", platform: "telegram", price: "1.05", min: "100" },
      { name: "Spotify Plays", platform: "spotify", price: "0.90", min: "1000" },
      { name: "X (Twitter) Followers", platform: "x", price: "2.10", min: "100" },
    ],
    categories: ["Followers", "Views", "Members", "Engagement"],
  },
};
