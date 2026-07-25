import type { DesignPackage } from "@/src/lib/design/schema";

/**
 * DESIGN #1 — "Pulse"
 * Direction: social-engagement energy. Vivid gradient backdrop, floating engagement
 * cards (likes / views / followers / notifications), a phone-feed mockup in the hero,
 * pill-shaped buttons, soft glassy cards, count-up stats.
 *
 * Everything here is presentation config only — the auth card and service list are
 * FUNCTIONAL slots rendered by Innvil's real components.
 */
export const PULSE: DesignPackage = {
  meta: {
    id: "pulse",
    name: "Pulse",
    tagline: "Social energy, in motion.",
    description:
      "A high-energy landing built around live social engagement: floating like/view/follower cards drift over a vivid gradient, a phone feed mockup previews real growth, and count-up stats make momentum feel tangible. Designed to convert first-time visitors into signups.",
    price: 29,
    categories: ["social-growth", "colorful", "animated", "conversion"],
    includedPages: ["landing", "login", "signup"],
    features: [
      "Animated floating engagement cards",
      "Phone feed mockup hero",
      "Count-up statistics",
      "Gradient backdrop with glass cards",
      "Live service catalog section",
      "Testimonials + FAQ accordion",
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
      background: "radial-gradient(120% 120% at 20% 0%, #7C3AED 0%, #DB2777 45%, #0B0614 100%)",
      accent: "#F472B6",
    },
  },

  tokens: {
    bg: "#0B0614",
    bgAlt: "#120A22",
    surface: "rgba(255,255,255,0.06)",
    surfaceAlt: "rgba(255,255,255,0.10)",
    border: "rgba(255,255,255,0.14)",
    text: "#FFFFFF",
    textDim: "rgba(255,255,255,0.72)",
    textFaint: "rgba(255,255,255,0.45)",
    accent: "#F472B6",
    accentAlt: "#A78BFA",
    backdrop: "radial-gradient(120% 100% at 15% -10%, rgba(124,58,237,0.55) 0%, rgba(219,39,119,0.35) 40%, rgba(11,6,20,0) 75%)",
    fontDisplay: "var(--font-display), Georgia, serif",
    fontBody: "var(--font-sans), system-ui, sans-serif",
    radius: "14px",
    radiusLg: "26px",
    shadow: "0 24px 60px -20px rgba(219,39,119,0.45)",
    sectionY: "5.5rem",
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
        ctas: [
          { label: "Log in", action: "login" },
          { label: "Get started", action: "signup" },
        ],
      },
      sections: [
        {
          id: "hero",
          type: "hero",
          variant: "split-float",
          animation: "fade-up",
          eyebrow: "Instant social growth",
          headline: "Grow your audience",
          headlineAccent: "while you sleep.",
          sub: "Followers, likes, views and more — delivered fast, priced clearly, tracked in real time from one simple wallet.",
          ctas: [
            { label: "Start growing", action: "signup" },
            { label: "Browse services", action: "services" },
          ],
          floats: [
            { kind: "like", label: "Likes", value: "+1.2K" },
            { kind: "follower", label: "Followers", value: "+840" },
            { kind: "view", label: "Views", value: "12.4K" },
            { kind: "comment", label: "Comments", value: "+96" },
            { kind: "notify", label: "Order complete" },
          ],
          mockup: "phone-feed",
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
            { label: "Support", value: "24/7" },
          ],
        },
        {
          id: "platforms",
          type: "platforms",
          variant: "pill-cloud",
          animation: "fade-up",
          heading: "Every platform you care about",
          sub: "Pick a platform and see everything available for it.",
        },
        {
          id: "services",
          type: "services",
          variant: "glow-cards",
          animation: "fade-up",
          heading: "Popular right now",
          sub: "Real services from this panel — transparent pricing, instant start.",
          limit: 6,
          showPrices: true,
        },
        {
          id: "steps",
          type: "steps",
          variant: "numbered-float",
          animation: "fade-up",
          heading: "Three steps to growth",
          steps: [
            { title: "Create your account", body: "Sign up in seconds — no approval queue, no waiting." },
            { title: "Add funds", body: "Top up your wallet with your preferred payment method." },
            { title: "Order and watch", body: "Pick a service, paste your link, and track delivery live." },
          ],
        },
        {
          id: "features",
          type: "features",
          variant: "glass-grid",
          animation: "fade-up",
          heading: "Built for people who post daily",
          items: [
            { title: "Instant start", body: "Most orders begin within minutes of payment clearing." },
            { title: "One wallet", body: "Fund once, order anything — no repeated checkouts." },
            { title: "Live tracking", body: "Every order shows real progress, not a black box." },
            { title: "Auto refunds", body: "Anything undelivered comes straight back to your balance." },
            { title: "Real support", body: "Open a ticket and get a human answer, fast." },
            { title: "Private by default", body: "Your links and orders stay yours. Always." },
          ],
        },
        {
          id: "testimonials",
          type: "testimonials",
          variant: "float-cards",
          animation: "fade-up",
          heading: "Creators are growing here",
          items: [
            { quote: "Went from 400 to 6,000 followers in a month. The delivery speed is unreal.", name: "Maya R.", role: "Content creator", rating: 5 },
            { quote: "I run campaigns for eight clients and this is the only panel I trust for volume.", name: "Deniz K.", role: "Agency owner", rating: 5 },
            { quote: "Simple wallet, clear prices, no surprises. Exactly what I wanted.", name: "Jordan T.", role: "Musician", rating: 5 },
          ],
        },
        {
          id: "auth",
          type: "functional",
          component: "auth-card",
          variant: "glass-centered",
          animation: "fade-up",
          heading: "Create your account",
          sub: "Takes less than a minute.",
        },
        {
          id: "faq",
          type: "faq",
          variant: "glass-accordion",
          heading: "Questions, answered",
          items: [
            { q: "How fast do orders start?", a: "Most services begin within a few minutes. Each service shows its own estimated start time before you order." },
            { q: "What if an order doesn't fully deliver?", a: "The undelivered portion is refunded to your wallet automatically — you never pay for what you didn't get." },
            { q: "Do I need to add funds before ordering?", a: "Yes. You top up your wallet once, then order as often as you like from that balance." },
            { q: "Is my information private?", a: "Your links and order history are visible only to you and the panel's support team." },
          ],
        },
        {
          id: "cta",
          type: "cta",
          variant: "gradient-band",
          animation: "fade-up",
          heading: "Your next thousand followers start today.",
          sub: "Create an account and place your first order in minutes.",
          ctas: [{ label: "Get started free", action: "signup" }],
        },
      ],
      footer: {
        variant: "glass-columns",
        blurb: "Fast, transparent social growth services — one wallet, every platform.",
        columns: [
          { title: "Explore", links: [{ label: "Services", href: "#services" }, { label: "How it works", href: "#steps" }] },
          { title: "Account", links: [{ label: "Log in", href: "/login" }, { label: "Create account", href: "/signup" }] },
        ],
      },
    },
  ],

  preview: {
    panelName: "PulseGrow",
    services: [
      { name: "Instagram Followers — High Quality", platform: "instagram", price: "1.35", min: "100" },
      { name: "TikTok Views — Instant", platform: "tiktok", price: "0.42", min: "1000" },
      { name: "YouTube Likes — Real", platform: "youtube", price: "2.10", min: "50" },
      { name: "Instagram Story Views", platform: "instagram", price: "0.85", min: "200" },
      { name: "X (Twitter) Retweets", platform: "x", price: "1.60", min: "100" },
      { name: "Facebook Page Likes", platform: "facebook", price: "1.95", min: "100" },
    ],
    categories: ["Followers", "Likes", "Views", "Comments", "Shares"],
  },
};
