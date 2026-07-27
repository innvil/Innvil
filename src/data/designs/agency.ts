import type { DesignPackage } from "@/src/lib/design/schema";

/**
 * DESIGN #3 — "Agency"
 * Direction: bold, colourful, playful (a distinct COMPOSITION, not a recolour of
 * Studio). Warm off-white canvas, coral→orange accent, very rounded cards, a
 * collage hero (accent tile + trophy card + platform-icon card) and full-colour
 * feature cards with big emoji. High-energy conversion look for mass-market panels.
 */
export const AGENCY: DesignPackage = {
  meta: {
    id: "agency",
    name: "Agency",
    tagline: "Loud, friendly, built to convert.",
    description:
      "A bold, colourful landing for panels that want mass-market energy: a playful card collage in the hero, full-colour feature tiles with big icons, very rounded shapes and warm gradients. Made to make first-time visitors register.",
    price: 10,
    categories: ["colorful", "conversion", "agency"],
    includedPages: ["landing", "login", "signup"],
    features: [
      "Playful card-collage hero",
      "Full-colour feature tiles",
      "Warm coral gradient palette",
      "Very rounded, friendly shapes",
      "Live catalog + trust stats",
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
      background: "linear-gradient(150deg, #FF5A3C 0%, #FF2D78 55%, #FF8A00 100%)",
      accent: "#FF5A3C",
    },
  },

  tokens: {
    bg: "#FFF6F2",
    bgAlt: "#FDEDE6",
    surface: "#FFFFFF",
    surfaceAlt: "#FFF1EB",
    border: "rgba(20,17,15,0.10)",
    text: "#171210",
    textDim: "rgba(40,30,26,0.72)",
    textFaint: "rgba(90,78,72,0.66)",
    accent: "#FF5A3C",
    accentAlt: "#FF8A00",
    backdrop: "radial-gradient(75% 55% at 88% -8%, rgba(255,90,60,0.16) 0%, rgba(255,138,0,0.10) 45%, rgba(255,246,242,0) 72%)",
    fontDisplay: "var(--font-sans), system-ui, sans-serif",
    fontBody: "var(--font-sans), system-ui, sans-serif",
    radius: "16px",
    radiusLg: "28px",
    shadow: "0 24px 55px -22px rgba(255,90,60,0.40)",
    sectionY: "5rem",
  },

  pages: [
    {
      id: "landing",
      header: {
        variant: "rounded-bar",
        sticky: true,
        links: [
          { label: "Services", href: "#services" },
          { label: "Why us", href: "#features" },
          { label: "Reviews", href: "#testimonials" },
          { label: "FAQ", href: "#faq" },
        ],
        ctas: [{ label: "Sign in", action: "login" }, { label: "Register", action: "signup" }],
      },
      sections: [
        {
          id: "hero",
          type: "hero",
          variant: "collage",
          animation: "fade-up",
          eyebrow: "🔥 Top SMM panel",
          headline: "Automate your social media",
          headlineAccent: "growth today.",
          sub: "Views, likes, followers and more — delivered fast and priced to move. Register in seconds and grow across every platform from one balance.",
          ctas: [
            { label: "Register free", action: "signup" },
            { label: "See services", action: "services" },
          ],
          mockup: "collage",
        },
        {
          id: "stats",
          type: "stats",
          variant: "pill-row",
          animation: "count-up",
          items: [
            { label: "Services", value: "—", source: "live" },
            { label: "Platforms", value: "—", source: "live" },
            { label: "From", value: "—", source: "live" },
            { label: "Support", value: "24/7" },
          ],
        },
        {
          id: "features",
          type: "features",
          variant: "color-cards",
          animation: "fade-up",
          heading: "Why thousands pick us",
          items: [
            { title: "Support 24/7", body: "Real people, around the clock, for anything technical or service-related.", icon: "🎧" },
            { title: "Instant delivery", body: "Most orders start within minutes — your campaigns never sit idle.", icon: "🚀" },
            { title: "Every platform", body: "Instagram, TikTok, YouTube, Spotify and more, all from one wallet.", icon: "📣" },
          ],
        },
        {
          id: "services",
          type: "services",
          variant: "cards",
          animation: "fade-up",
          heading: "Services people love",
          sub: "Clear pricing, instant start, delivery you can watch.",
          limit: 6,
          showPrices: true,
        },
        {
          id: "steps",
          type: "steps",
          variant: "bubbles",
          animation: "fade-up",
          heading: "Grow in three easy steps",
          steps: [
            { title: "Register", body: "Create your account in seconds — no waiting." },
            { title: "Add funds", body: "Top up your wallet with your favourite method." },
            { title: "Order & grow", body: "Pick a service, paste your link, watch it climb." },
          ],
        },
        {
          id: "testimonials",
          type: "testimonials",
          variant: "bubbly",
          animation: "fade-up",
          heading: "People are growing here",
          items: [
            { quote: "Cheapest prices I've found and the delivery is genuinely fast. Hooked.", name: "Sam O.", role: "Creator", rating: 5 },
            { quote: "I run promos for small businesses — this panel makes me look great.", name: "Aisha K.", role: "Freelance marketer", rating: 5 },
            { quote: "Simple, colourful, and it just works. Exactly what I wanted.", name: "Leo P.", role: "Musician", rating: 5 },
          ],
        },
        {
          id: "auth",
          type: "functional",
          component: "auth-card",
          variant: "rounded-centered",
          animation: "fade-up",
          heading: "Create your account",
          sub: "Register free and place your first order in minutes.",
        },
        {
          id: "faq",
          type: "faq",
          variant: "bubbly-accordion",
          heading: "Good questions",
          items: [
            { q: "How fast do orders start?", a: "Most services begin within a few minutes. Each service shows its estimated start time before you order." },
            { q: "What if an order doesn't fully deliver?", a: "The undelivered portion is refunded to your wallet automatically — you only pay for what lands." },
            { q: "Do I need to add funds first?", a: "Yes. Top up once, then order as often as you like from that balance." },
            { q: "Is my info private?", a: "Your links and order history are visible only to you and the panel's support team." },
          ],
        },
        {
          id: "cta",
          type: "cta",
          variant: "big-band",
          animation: "fade-up",
          heading: "Ready to blow up? Let's go.",
          sub: "Register now and place your first order in minutes.",
          ctas: [{ label: "Register free", action: "signup" }],
        },
      ],
      footer: {
        variant: "rounded-columns",
        blurb: "Fast, friendly, affordable social growth — one wallet, every platform.",
        columns: [
          { title: "Explore", links: [{ label: "Services", href: "#services" }, { label: "Why us", href: "#features" }] },
          { title: "Account", links: [{ label: "Sign in", href: "/login" }, { label: "Register", href: "/signup" }] },
        ],
      },
    },
  ],

  preview: {
    panelName: "BoostHub",
    services: [
      { name: "Instagram Followers — Instant", platform: "instagram", price: "1.20", min: "100" },
      { name: "TikTok Views — Fast", platform: "tiktok", price: "0.35", min: "1000" },
      { name: "YouTube Views — HR", platform: "youtube", price: "1.70", min: "1000" },
      { name: "Spotify Plays", platform: "spotify", price: "0.85", min: "1000" },
      { name: "Telegram Members", platform: "telegram", price: "1.10", min: "100" },
      { name: "X (Twitter) Likes", platform: "x", price: "1.40", min: "50" },
    ],
    categories: ["Followers", "Views", "Likes", "Plays", "Members"],
  },
};
