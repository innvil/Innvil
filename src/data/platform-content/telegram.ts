import type { PlatformContentPack } from "@/src/lib/design/platform-content";

/* Telegram marketing content pack. Overlaid onto whatever landing/design is active on a
   Telegram-focused panel, so the storefront reads as a dedicated Telegram growth service
   (the design supplies the look; this supplies the words). */

export const TELEGRAM_CONTENT: PlatformContentPack = {
  key: "telegram",
  label: "Telegram",

  landing: {
    headline: "Grow your Telegram, fast.",
    description: "Members, post views, reactions and more — delivered to your channel or group with instant start and transparent pricing.",
  },

  hero: {
    eyebrow: "Telegram growth, done right",
    headline: "More members, views & reactions on",
    headlineAccent: "Telegram",
    sub: "Boost your channel or group with real-looking Telegram members, post views and reactions. Instant start, steady delivery, one simple wallet.",
    floats: [
      { kind: "follower", label: "Members", value: "+2,500" },
      { kind: "view", label: "Post views", value: "+18k" },
      { kind: "heart", label: "Reactions", value: "👍 340" },
      { kind: "notify", label: "New join", value: "just now" },
    ],
  },

  services: { heading: "Telegram services", sub: "Everything to grow your channel or group — priced per 1,000." },
  platforms: { heading: "Built for Telegram", sub: "One platform, done properly." },

  features: {
    heading: "Why grow your Telegram with us",
    items: [
      { title: "Channel & group members", body: "Add members to public channels and groups to build instant social proof.", icon: "👥" },
      { title: "Post views", body: "Pump views on any post or forwarded message — single or last-N posts.", icon: "👁️" },
      { title: "Reactions & polls", body: "Positive reactions and poll votes that make your posts look active.", icon: "👍" },
      { title: "Instant start", body: "Most Telegram orders begin within minutes — no waiting around.", icon: "⚡" },
      { title: "Refill on drops", body: "Eligible member services include a refill window if counts dip.", icon: "🔁" },
      { title: "One wallet, clear pricing", body: "Top up once and order anything — the price you see is the price you pay.", icon: "💳" },
    ],
  },

  steps: {
    heading: "Grow your Telegram in 4 steps",
    items: [
      { title: "Create your account", body: "Sign up in seconds — no approval needed." },
      { title: "Add funds", body: "Top up your wallet with crypto or your preferred method." },
      { title: "Paste your link", body: "Drop in your channel, group or post link and pick a service." },
      { title: "Watch it grow", body: "Delivery starts fast and you can track every order live." },
    ],
  },

  testimonials: {
    heading: "Channel owners love it",
    items: [
      { quote: "Added 5k members to my channel in a day — delivery was smooth and stayed put.", name: "Deniz", role: "Crypto channel" },
      { quote: "Post views on my last 10 posts made the whole channel look alive. Instant start too.", name: "Mara", role: "News group admin" },
      { quote: "Cheapest reliable Telegram panel I've used, and the wallet makes reordering effortless.", name: "Ivan", role: "Reseller" },
    ],
  },

  faq: {
    heading: "Telegram questions, answered",
    items: [
      { q: "What Telegram services can I order?", a: "Channel/group members, post views (single or last-N posts), reactions and poll votes, depending on what's in the catalog." },
      { q: "How fast does delivery start?", a: "Most Telegram orders start within minutes. Larger member orders deliver at a steady, natural pace." },
      { q: "Will members drop off?", a: "Some natural drop can happen. Eligible member services include a refill window — check the service details before ordering." },
      { q: "Do I need to make my channel public?", a: "Members usually require a public channel/group link. Post views work on any accessible post link." },
      { q: "How do I pay?", a: "Add funds to your wallet once (crypto and more), then order anything. No per-order checkout." },
    ],
  },

  cta: { heading: "Ready to grow your Telegram?", sub: "Create your account and place your first order in minutes." },

  seo: {
    title: "Buy Telegram members, views & reactions",
    description: "Grow your Telegram channel or group with real-looking members, post views and reactions. Instant start, one wallet, transparent pricing.",
  },
};
