/* =========================================================
   TYPES
   ========================================================= */

export type PanelStatus = "draft" | "live" | "inactive" | "suspended" | "maintenance";

/* =========================================================
   PANEL STATUS CONFIGURATION
   ========================================================= */

export const PANEL_STATUSES: Record<PanelStatus, {
  label: string;
  description: string;
  customerCanBrowse: boolean;
  customerCanOrder: boolean;
  tone: string;
}> = {
  draft: {
    label: "Draft",
    description: "Panel is being set up. Not visible to customers.",
    customerCanBrowse: false,
    customerCanOrder: false,
    tone: "muted",
  },
  live: {
    label: "Live",
    description: "Panel is fully operational. Customers can browse and order.",
    customerCanBrowse: true,
    customerCanOrder: true,
    tone: "safe",
  },
  inactive: {
    label: "Inactive Mode",
    description: "Panel stays online. Customers can browse, log in, view dashboard, view services, view order history, view tickets, view wallet balance, and add funds (if deposits enabled). Cannot submit new orders, mass orders, or use order-submission API endpoints.",
    customerCanBrowse: true,
    customerCanOrder: false,
    tone: "gold",
  },
  suspended: {
    label: "Suspended",
    description: "Panel is offline. Panel owner must contact Innvil support to restore.",
    customerCanBrowse: false,
    customerCanOrder: false,
    tone: "danger",
  },
  maintenance: {
    label: "Maintenance",
    description: "Panel is temporarily offline for maintenance. Automatically returns to previous status when maintenance ends.",
    customerCanBrowse: false,
    customerCanOrder: false,
    tone: "violet",
  },
};

/* =========================================================
   MOCK DATA
   ========================================================= */

export const panels: Array<{
  id: string;
  name: string;
  subdomain: string;
  domain: string | null;
  status: PanelStatus;
  ordersToday: number;
  theme: string;
}> = [
  { id: "novaboost", name: "NovaBoost", subdomain: "novaboost.innvil.app", domain: null, status: "live", ordersToday: 214.6, theme: "Obsidian Gold" },
  { id: "pulsesmm", name: "PulseSMM", subdomain: "pulsesmm.innvil.app", domain: "pulsesmm.com", status: "live", ordersToday: 88.2, theme: "Violet Night" },
  { id: "draft", name: "Untitled Panel", subdomain: "draft-3f2a.innvil.app", domain: null, status: "draft", ordersToday: 0, theme: "—" },
  { id: "inactive-demo", name: "GrowSocials", subdomain: "growsocials.innvil.app", domain: "growsocials.com", status: "inactive", ordersToday: 0, theme: "Neon Slate" },
  { id: "suspended-demo", name: "QuickFollowers", subdomain: "quickfollowers.innvil.app", domain: null, status: "suspended", ordersToday: 0, theme: "Ivory Minimal" },
  { id: "maintenance-demo", name: "SMMPro", subdomain: "smmpro.innvil.app", domain: "smmpro.io", status: "maintenance", ordersToday: 0, theme: "Obsidian Gold" },
];

export const revenueData = [
  { m: "Feb", v: 4200 },
  { m: "Mar", v: 6100 },
  { m: "Apr", v: 5800 },
  { m: "May", v: 8900 },
  { m: "Jun", v: 12400 },
  { m: "Jul", v: 18420 },
];

export const ledgerlineBalance = {
  balance: 128.4,
  ordersToday: 302.8,
  commissionPending: 15.14,
  feePct: 5,
  chargesIn: "24h",
};

export const floorServices = [
  { name: "Instagram Followers", floor: 0.9, price: 1.35, markup: 50, unit: "1k", enabled: true, category: "Instagram", min: 100, max: 100000, refill: true, cancel: true, drip: false, featured: true },
  { name: "TikTok Views", floor: 0.12, price: 0.19, markup: 58, unit: "1k", enabled: true, category: "TikTok", min: 100, max: 500000, refill: true, cancel: false, drip: true, featured: false },
  { name: "YouTube Watch Hours", floor: 2.4, price: 3.1, markup: 29, unit: "1k", enabled: true, category: "YouTube", min: 500, max: 4000, refill: false, cancel: true, drip: false, featured: false },
  { name: "X Retweets", floor: 0.75, price: 0.75, markup: 0, unit: "1k", enabled: false, category: "X", min: 50, max: 20000, refill: false, cancel: false, drip: false, featured: false },
  { name: "Spotify Plays", floor: 0.3, price: 0.44, markup: 47, unit: "1k", enabled: true, category: "Spotify", min: 1000, max: 1000000, refill: true, cancel: false, drip: true, featured: false },
];

export const recentOrders = [
  { id: "8841", service: "Instagram Followers", qty: "5,000", customer: "@marisol.co", amount: "$6.75", status: "Completed" },
  { id: "8840", service: "TikTok Views", qty: "50,000", customer: "@duskmedia", amount: "$9.50", status: "Processing" },
  { id: "8839", service: "YouTube Watch Hours", qty: "1,000", customer: "@nova_agency", amount: "$3.10", status: "Completed" },
  { id: "8838", service: "Spotify Plays", qty: "20,000", customer: "@lumenpr", amount: "$8.80", status: "Queued" },
];

export const customers = [
  { handle: "@marisol.co", panel: "NovaBoost", orders: 18, spent: "$142.30", joined: "May 2026" },
  { handle: "@duskmedia", panel: "NovaBoost", orders: 9, spent: "$61.10", joined: "Jun 2026" },
  { handle: "@nova_agency", panel: "PulseSMM", orders: 24, spent: "$310.00", joined: "Mar 2026" },
];

export const tickets = [
  { subj: "Order #8840 stuck on processing", from: "@duskmedia", tag: "Auto-replied", time: "2m" },
  { subj: "How do I raise my TikTok price?", from: "@nova_agency", tag: "Auto-replied", time: "14m" },
  { subj: "API key not connecting to provider", from: "@haloworks", tag: "Needs human", time: "41m" },
];

export const topUpMethods = [
  { name: "Cryptomus", sub: "USDT, BTC, ETH & more — instant credit", status: "active" },
  { name: "Card / Bank (Stripe)", sub: "Fiat & forex — coming soon", status: "soon" },
  { name: "PayPal", sub: "Fiat — coming soon", status: "soon" },
];

export const themes = [
  { name: "Obsidian Gold", a: "#C9A574", b: "#0A0B0F" },
  { name: "Violet Night", a: "#8B7FFF", b: "#0D0B14" },
  { name: "Ivory Minimal", a: "#8A8467", b: "#EDEAE2" },
  { name: "Neon Slate", a: "#4DE8D0", b: "#0A0F0F" },
];

export const liveServices = [
  { name: "Instagram Followers", price: 1.35, unit: "1k", category: "Instagram" },
  { name: "TikTok Views", price: 0.19, unit: "1k", category: "TikTok" },
  { name: "YouTube Watch Hours", price: 3.1, unit: "1k", category: "YouTube" },
  { name: "X Retweets", price: 0.75, unit: "1k", category: "X" },
  { name: "Spotify Plays", price: 0.44, unit: "1k", category: "Spotify" },
  { name: "Facebook Likes", price: 0.89, unit: "1k", category: "Facebook" },
];

export const allPanelsAdmin: Array<{
  name: string;
  owner: string;
  status: PanelStatus;
  verified: boolean;
}> = [
  { name: "NovaBoost", owner: "kg@ledgerline", status: "live", verified: true },
  { name: "PulseSMM", owner: "jrmz@ledgerline", status: "live", verified: true },
  { name: "Untitled Panel", owner: "kg@ledgerline", status: "draft", verified: false },
  { name: "GrowFast Panel", owner: "haloworks@ledgerline", status: "suspended", verified: false },
  { name: "GrowSocials", owner: "grow@ledgerline", status: "inactive", verified: true },
  { name: "SMMPro", owner: "smmpro@ledgerline", status: "maintenance", verified: true },
];

export const providersData: Array<{
  name: string;
  priority: number;
  status: "Active" | "Paused";
  health: "Healthy" | "Degraded";
  lastSync: string;
}> = [
  { name: "Provider Alpha API", priority: 1, status: "Active", health: "Healthy", lastSync: "6m ago" },
  { name: "Backup SMM Source", priority: 2, status: "Paused", health: "Degraded", lastSync: "2d ago" },
];

export const categoriesData: Array<{ name: string; count: number; hidden: boolean }> = [
  { name: "Instagram", count: 12, hidden: false },
  { name: "TikTok", count: 8, hidden: false },
  { name: "YouTube", count: 6, hidden: false },
  { name: "Facebook", count: 4, hidden: false },
  { name: "Telegram", count: 3, hidden: true },
  { name: "Spotify", count: 2, hidden: false },
  { name: "Website Traffic", count: 5, hidden: false },
];

export const orderDetailExtras = {
  providerOrderId: "PA-88214",
  providerResponse: "completed",
};

export const customerProfileExtra = {
  wallet: "$14.20",
  deposits: ["+$25.00 via Stripe · 3d ago", "+$10.00 via Crypto · 12d ago"],
  logins: ["Manila, PH · Chrome · 2h ago", "Manila, PH · iOS app · 1d ago"],
  referral: "Referred by @lumenpr · 2 referrals made",
  apiKey: "cus_9f2a...c81e",
};

/* =========================================================
   CUSTOMER EXPERIENCE (Phase 1) — platforms, services, orders
   ========================================================= */

export type PlatformKey =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "x"
  | "facebook"
  | "telegram"
  | "spotify";

export const PLATFORMS: Array<{
  key: PlatformKey;
  label: string;
  aliases: string[];
}> = [
  { key: "instagram", label: "Instagram", aliases: ["ig", "insta", "gram"] },
  { key: "tiktok", label: "TikTok", aliases: ["tt", "tik tok"] },
  { key: "youtube", label: "YouTube", aliases: ["yt", "you tube"] },
  { key: "x", label: "X", aliases: ["twitter", "tweet", "tweets"] },
  { key: "facebook", label: "Facebook", aliases: ["fb", "meta"] },
  { key: "telegram", label: "Telegram", aliases: ["tg", "tele"] },
  { key: "spotify", label: "Spotify", aliases: ["spot", "music"] },
];

export interface CustomerService {
  id: number;
  /** Real DB service UUID, when this row is backed by live data (used to place
      real orders). Absent for mock/preview services. */
  uuid?: string;
  platform: PlatformKey;
  category: string;
  name: string;
  price: number; // per unit block
  unit: string;
  min: number;
  max: number;
  startTime: string;
  completion: string;
  refill: boolean;
  cancel: boolean;
  drip: boolean;
  /** Custom Comments service — the buyer supplies a list of comments (one per line). */
  comments?: boolean;
  description: string;
  aliases: string[];
}

export const customerServices: CustomerService[] = [
  { id: 2101, platform: "instagram", category: "Followers", name: "Instagram Followers — HQ", price: 1.35, unit: "1k", min: 100, max: 100000, startTime: "0–15 min", completion: "~24h per 10k", refill: true, cancel: true, drip: true, description: "High-quality followers with profile pictures. 30-day refill guarantee.", aliases: ["ig followers", "insta followers"] },
  { id: 2102, platform: "instagram", category: "Followers", name: "Instagram Followers — Economy", price: 0.85, unit: "1k", min: 100, max: 50000, startTime: "0–1h", completion: "~48h per 10k", refill: false, cancel: true, drip: false, description: "Budget followers, mixed quality. No refill.", aliases: ["cheap followers"] },
  { id: 2110, platform: "instagram", category: "Likes", name: "Instagram Likes — Instant", price: 0.42, unit: "1k", min: 50, max: 30000, startTime: "0–5 min", completion: "~1h per 5k", refill: false, cancel: true, drip: true, description: "Instant likes on posts or reels.", aliases: ["ig likes", "insta likes"] },
  { id: 2115, platform: "instagram", category: "Views", name: "Instagram Reel Views", price: 0.09, unit: "1k", min: 500, max: 1000000, startTime: "0–10 min", completion: "~6h per 100k", refill: false, cancel: false, drip: true, description: "Reel views, gradual delivery available.", aliases: ["reel views", "ig views"] },
  { id: 2201, platform: "tiktok", category: "Views", name: "TikTok Views", price: 0.19, unit: "1k", min: 100, max: 500000, startTime: "0–5 min", completion: "~2h per 100k", refill: true, cancel: false, drip: true, description: "Fast video views with drip-feed option.", aliases: ["tt views", "tik tok views"] },
  { id: 2205, platform: "tiktok", category: "Followers", name: "TikTok Followers", price: 2.1, unit: "1k", min: 100, max: 50000, startTime: "0–30 min", completion: "~24h per 5k", refill: true, cancel: true, drip: false, description: "Real-looking followers, 30-day refill.", aliases: ["tt followers"] },
  { id: 2210, platform: "tiktok", category: "Likes", name: "TikTok Likes", price: 0.55, unit: "1k", min: 50, max: 100000, startTime: "0–10 min", completion: "~4h per 20k", refill: false, cancel: true, drip: true, description: "Likes on any public video.", aliases: ["tt likes"] },
  { id: 2301, platform: "youtube", category: "Views", name: "YouTube Views — Retention", price: 1.6, unit: "1k", min: 500, max: 1000000, startTime: "0–6h", completion: "~72h per 50k", refill: true, cancel: false, drip: true, description: "High-retention views, monetization-safe pacing.", aliases: ["yt views"] },
  { id: 2305, platform: "youtube", category: "Watch Hours", name: "YouTube Watch Hours", price: 3.1, unit: "1k", min: 500, max: 4000, startTime: "6–24h", completion: "~7 days", refill: false, cancel: true, drip: false, description: "Watch-time hours toward monetization threshold.", aliases: ["yt watch hours", "watchtime"] },
  { id: 2310, platform: "youtube", category: "Subscribers", name: "YouTube Subscribers", price: 12.5, unit: "1k", min: 50, max: 10000, startTime: "0–12h", completion: "~5 days per 1k", refill: true, cancel: true, drip: false, description: "Gradual subscriber growth, 60-day refill.", aliases: ["yt subs", "subscribers"] },
  { id: 2401, platform: "x", category: "Views", name: "X Views", price: 0.05, unit: "1k", min: 500, max: 5000000, startTime: "0–5 min", completion: "~1h per 500k", refill: false, cancel: false, drip: true, description: "Video/post views on X.", aliases: ["twitter views", "tweet views"] },
  { id: 2405, platform: "x", category: "Retweets", name: "X Reposts", price: 0.75, unit: "1k", min: 50, max: 20000, startTime: "0–15 min", completion: "~3h per 5k", refill: false, cancel: true, drip: false, description: "Reposts from mixed-quality accounts.", aliases: ["retweets", "twitter retweets", "rt"] },
  { id: 2410, platform: "x", category: "Followers", name: "X Followers", price: 2.9, unit: "1k", min: 100, max: 50000, startTime: "0–1h", completion: "~24h per 5k", refill: true, cancel: true, drip: false, description: "Followers with avatars, 30-day refill.", aliases: ["twitter followers"] },
  { id: 2501, platform: "facebook", category: "Likes", name: "Facebook Page Likes", price: 0.89, unit: "1k", min: 100, max: 50000, startTime: "0–1h", completion: "~24h per 5k", refill: true, cancel: true, drip: true, description: "Page likes + follows combined.", aliases: ["fb likes", "page likes"] },
  { id: 2505, platform: "facebook", category: "Followers", name: "Facebook Profile Followers", price: 1.2, unit: "1k", min: 100, max: 30000, startTime: "0–2h", completion: "~24h per 5k", refill: false, cancel: true, drip: false, description: "Followers for personal profiles.", aliases: ["fb followers"] },
  { id: 2601, platform: "telegram", category: "Members", name: "Telegram Channel Members", price: 1.05, unit: "1k", min: 100, max: 100000, startTime: "0–30 min", completion: "~12h per 20k", refill: false, cancel: true, drip: false, description: "Members for public channels or groups.", aliases: ["tg members", "channel members"] },
  { id: 2605, platform: "telegram", category: "Views", name: "Telegram Post Views", price: 0.04, unit: "1k", min: 500, max: 1000000, startTime: "0–5 min", completion: "~1h per 100k", refill: false, cancel: false, drip: true, description: "Views on last N posts.", aliases: ["tg views", "post views"] },
  { id: 2701, platform: "spotify", category: "Plays", name: "Spotify Plays", price: 0.44, unit: "1k", min: 1000, max: 1000000, startTime: "12–24h", completion: "~3 days per 100k", refill: true, cancel: false, drip: true, description: "Royalty-eligible plays, gradual delivery.", aliases: ["spotify streams", "plays"] },
  { id: 2705, platform: "spotify", category: "Followers", name: "Spotify Followers", price: 1.8, unit: "1k", min: 100, max: 100000, startTime: "0–12h", completion: "~48h per 10k", refill: false, cancel: true, drip: false, description: "Artist or playlist followers.", aliases: ["playlist followers"] },
];

export interface CustomerOrder {
  id: string;
  serviceId: number;
  serviceNo?: number | null; // the service's own number
  service: string;
  link: string;
  qty: number;
  amount: string;
  status: "Completed" | "Processing" | "Pending" | "Partial" | "Canceled";
  date: string;
  failReason?: string | null;
  comments?: string[] | null;
}

export const customerOrders: CustomerOrder[] = [
  { id: "8841", serviceId: 2101, service: "Instagram Followers — HQ", link: "instagram.com/marisol.co", qty: 5000, amount: "$6.75", status: "Completed", date: "Today, 09:14" },
  { id: "8836", serviceId: 2201, service: "TikTok Views", link: "tiktok.com/@marisol/video/88...", qty: 50000, amount: "$9.50", status: "Processing", date: "Today, 08:02" },
  { id: "8820", serviceId: 2110, service: "Instagram Likes — Instant", link: "instagram.com/p/Cx99...", qty: 2000, amount: "$0.84", status: "Completed", date: "Yesterday" },
  { id: "8811", serviceId: 2401, service: "X Views", link: "x.com/marisol/status/17...", qty: 100000, amount: "$5.00", status: "Pending", date: "Yesterday" },
  { id: "8794", serviceId: 2701, service: "Spotify Plays", link: "open.spotify.com/track/4u...", qty: 20000, amount: "$8.80", status: "Completed", date: "Jul 4" },
];

export const customerWallet = {
  balance: 24.6,
  deposits: [
    { amount: "+$25.00", method: "Cryptomus (USDT)", date: "Jul 3", status: "Confirmed" },
    { amount: "+$10.00", method: "Cryptomus (BTC)", date: "Jun 24", status: "Confirmed" },
  ],
};

export const customerTickets = [
  { id: "T-114", subj: "Order #8836 stuck on processing", status: "Answered", updated: "2h ago" },
  { id: "T-102", subj: "Refill request for order #8720", status: "Closed", updated: "Jun 28" },
];

// Seed state for favorites / recents (mock — becomes DB-backed in Phase 3)
export const initialFavoriteIds: number[] = [2101, 2201];
export const recentServiceIds: number[] = [2101, 2201, 2110, 2401, 2701];

export const auditLogs: Array<{ a: string; t: string }> = [
  { a: "Super Admin logged in as owner of NovaBoost", t: "3m ago" },
  { a: "Suspended GrowFast Panel — policy violation", t: "1h ago" },
  { a: "Verified panel owner haloworks@ledgerline", t: "4h ago" },
  { a: "Manually adjusted @nova_agency balance +$10.00", t: "1d ago" },
];
