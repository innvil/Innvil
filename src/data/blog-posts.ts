/**
 * Innvil guides / blog — the single source of truth for BOTH the blog index
 * (app/blog/page.tsx) and each article page (app/blog/[slug]/page.tsx), plus the
 * sitemap. Plain data module (not "use client") so server components can import it.
 *
 * Content is stored as structured blocks (not raw HTML/markdown) so every article
 * renders as clean semantic HTML (h2/h3/p/ul/ol) for search engines, with a tiny
 * inline **bold** convention handled by the renderer. Keep articles genuinely
 * useful — helpful content ranks; thin promo doesn't.
 */

export type BlogBlock =
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string };

export interface BlogSection {
  h2: string;
  blocks: BlogBlock[];
}

export interface BlogPost {
  slug: string;
  /** Used for <title> and the article H1. */
  title: string;
  /** Meta description + the excerpt shown on the index card. */
  description: string;
  /** ISO date published. */
  date: string;
  /** ISO date last updated (defaults to `date`). */
  updated?: string;
  readMinutes: number;
  tag: string;
  keywords: string[];
  /** Lead paragraph under the H1. */
  intro: string;
  sections: BlogSection[];
  /** Closing call-to-action card. */
  cta?: { heading: string; text: string };
  /** Slugs of related posts to cross-link at the foot of the article. */
  related?: string[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "how-to-start-an-smm-panel",
    title: "How to Start Your Own SMM Panel in 2026 (Step-by-Step)",
    description:
      "A practical, no-fluff guide to starting your own SMM panel in 2026 — how panels actually make money, what you need before you launch, and the exact steps to go from zero to a live storefront.",
    date: "2026-07-21",
    updated: "2026-07-23",
    readMinutes: 8,
    tag: "Getting started",
    keywords: [
      "how to start an smm panel",
      "start your own smm panel",
      "create an smm panel",
      "smm panel business",
      "smm reseller panel",
    ],
    intro:
      "Starting an SMM panel used to mean buying a PHP script, renting a server, wiring up a payment gateway, and debugging provider APIs before you could take a single order. In 2026 you can skip almost all of that. This guide walks through how SMM panels actually make money, what you genuinely need before launch, and the step-by-step path to a live storefront — without writing code.",
    sections: [
      {
        h2: "What is an SMM panel, really?",
        blocks: [
          {
            kind: "p",
            text: "An SMM (social media marketing) panel is an online storefront that sells social engagement services — followers, likes, views, comments, and so on — usually in bulk and at low prices. Customers top up a wallet, pick a service, paste a link, and place an order.",
          },
          {
            kind: "p",
            text: "The key thing to understand is that **most panel owners don't fulfil orders themselves**. They resell. Behind almost every panel is a larger wholesale **provider** that actually delivers the engagement. The panel's job is presentation, pricing, payments, and support — not delivery.",
          },
          {
            kind: "p",
            text: "That's good news for you: you don't need any technical delivery infrastructure. You need a storefront, a provider to resell, and a way to take money.",
          },
        ],
      },
      {
        h2: "How SMM panels make money",
        blocks: [
          {
            kind: "p",
            text: "The model is simple markup. Your provider charges you a wholesale rate (a \"floor\"); you set a retail price above it; you keep the difference.",
          },
          {
            kind: "ol",
            items: [
              "Your provider charges, say, $0.80 per 1,000 followers.",
              "You list that service at $2.00 per 1,000.",
              "A customer orders 5,000 followers and pays you $10.00.",
              "Your provider fulfils it and bills you $4.00.",
              "You keep $6.00 — minus whatever your platform takes.",
            ],
          },
          {
            kind: "p",
            text: "Your margin is entirely yours to set. The winning panels compete on trust, speed, support, and catalog breadth — not just on being the cheapest.",
          },
        ],
      },
      {
        h2: "What you need before you launch",
        blocks: [
          { kind: "h3", text: "1. A provider (bring your own)" },
          {
            kind: "p",
            text: "Sign up with one or more established SMM providers that expose an API. You'll get an API key and access to their service catalog. Keep this key private — a good platform only ever uses it server-side and never exposes it in the browser.",
          },
          { kind: "h3", text: "2. A storefront" },
          {
            kind: "p",
            text: "This is where a builder like Innvil replaces the old script-and-server setup. Instead of hosting code, you create a white-label panel with its own subdomain, storefront, customer dashboard, and wallet — branded as yours, live in minutes.",
          },
          { kind: "h3", text: "3. A payment method for your customers" },
          {
            kind: "p",
            text: "Connect a gateway so customers can fund their wallets. Crypto is the fastest to set up and popular in this space — Innvil supports Cryptomus and NOWPayments (300+ coins) today, with deposits crediting the wallet automatically on confirmation.",
          },
        ],
      },
      {
        h2: "Step-by-step: from zero to a live panel",
        blocks: [
          {
            kind: "ol",
            items: [
              "**Create your panel.** Name it, choose a subdomain, pick a theme. You now have a real storefront URL.",
              "**Connect your provider.** Paste your provider's API key. The platform pulls their full catalog for you.",
              "**Import and price services.** Select the services you want to sell and apply your markup (a percentage, a multiplier, or a fixed amount above the floor). Everything gets auto-organized by platform and type.",
              "**Set up payments.** Connect your payment gateway so customers can top up their wallets.",
              "**Preview, then go live.** Browse your own storefront exactly as a customer would. When it looks right, fund the panel and flip it live to start accepting orders.",
              "**Promote.** Share your link, connect a custom domain, and start driving traffic.",
            ],
          },
          {
            kind: "p",
            text: "With Innvil you can build and preview the whole storefront for free — you only fund a panel when you're ready to take real orders.",
          },
        ],
      },
      {
        h2: "How much does it cost to start?",
        blocks: [
          {
            kind: "p",
            text: "Less than most people expect. The two real costs are (1) whatever you deposit with your provider to fulfil orders, and (2) your platform's cut. Innvil charges **no monthly rent and no setup fee** — just 5% commission on completed orders (and that rate drops as you scale). We break the numbers down in a dedicated guide below.",
          },
        ],
      },
      {
        h2: "Common mistakes to avoid",
        blocks: [
          {
            kind: "ul",
            items: [
              "**Racing to the bottom on price.** Ultra-thin margins leave nothing for refunds, support, or ads. Price for a sustainable business.",
              "**Relying on a single provider.** Providers have outages and drop services. Connect more than one so you can route around problems.",
              "**Ignoring support.** In SMM, trust is the product. Fast, honest support turns first-time buyers into repeat customers.",
              "**Exposing your provider API key.** Only use platforms that keep keys server-side. A leaked key is a leaked wallet.",
            ],
          },
        ],
      },
    ],
    cta: {
      heading: "Ready to launch your panel?",
      text: "Create your first white-label SMM panel free and preview it live before you spend a cent. No monthly rent — 5% on completed orders only.",
    },
    related: ["white-label-smm-panel-vs-smm-panel-script", "how-much-does-an-smm-panel-cost"],
  },

  {
    slug: "white-label-smm-panel-vs-smm-panel-script",
    title: "White-Label SMM Panel vs. SMM Panel Script: Which Should You Choose?",
    description:
      "Buying an SMM panel script vs. using a hosted white-label panel builder — a clear comparison of cost, time-to-launch, maintenance, security, and lock-in, so you can pick the right path.",
    date: "2026-07-22",
    updated: "2026-07-23",
    readMinutes: 7,
    tag: "Compare",
    keywords: [
      "smm panel script",
      "white label smm panel",
      "smm panel builder",
      "buy smm panel script",
      "hosted smm panel",
    ],
    intro:
      "There are two ways to get an SMM panel of your own: buy a script and host it yourself, or use a hosted white-label builder. Both can work — but they suit very different people. Here's an honest comparison across the things that actually matter after launch day.",
    sections: [
      {
        h2: "What each option actually is",
        blocks: [
          { kind: "h3", text: "An SMM panel script" },
          {
            kind: "p",
            text: "A downloadable codebase (often PHP) that you buy once and install on your own server. You own the files, and you're responsible for everything: hosting, SSL, updates, security patches, database backups, and debugging when a provider changes their API.",
          },
          { kind: "h3", text: "A white-label panel builder" },
          {
            kind: "p",
            text: "A hosted platform where you create panels through a dashboard. There's nothing to install or maintain — the platform runs the infrastructure, and you focus on branding, pricing, and customers. Innvil is this kind of tool: no-code, live in minutes, billed as a small commission instead of a licence fee.",
          },
        ],
      },
      {
        h2: "Time to launch",
        blocks: [
          {
            kind: "p",
            text: "A script means provisioning a server, installing the app, configuring a database, pointing DNS, issuing SSL, and testing provider connections before you can sell anything. Realistically that's days, not minutes — longer if you're not comfortable on a command line.",
          },
          {
            kind: "p",
            text: "A builder collapses that to: create panel → connect provider → import services → go live. You can have a real storefront the same afternoon.",
          },
        ],
      },
      {
        h2: "Cost structure",
        blocks: [
          {
            kind: "p",
            text: "This is where they differ most. A script has an upfront licence fee plus ongoing **fixed** costs — hosting, occasional developer time — that you pay whether or not you make sales. Many hosted panels charge **monthly rent** for the same reason.",
          },
          {
            kind: "p",
            text: "Innvil flips that to a **variable** cost: 0% monthly rent, and 5% commission only on orders that actually complete. If you don't sell, you don't pay. The rate also drops toward 1% as volume grows, and never exceeds $100 from one panel in a day.",
          },
          {
            kind: "quote",
            text: "Fixed costs punish you during slow months. A commission aligns the platform with your growth instead.",
          },
        ],
      },
      {
        h2: "Maintenance and security",
        blocks: [
          {
            kind: "p",
            text: "With a self-hosted script, security is your job. Outdated panel scripts are a well-known target — an unpatched install can leak customer data or, worse, your provider API keys and wallet. You're also on the hook for uptime and backups.",
          },
          {
            kind: "p",
            text: "A hosted builder handles patching, uptime, and key security for you. On Innvil, provider API keys are encrypted and only ever used server-side — they never reach the browser.",
          },
        ],
      },
      {
        h2: "Ownership and lock-in",
        blocks: [
          {
            kind: "p",
            text: "The honest advantage of a script is control: you hold the code and the database. The trade-off is that all the maintenance burden is yours too.",
          },
          {
            kind: "p",
            text: "A good builder should minimize lock-in even without handing over code. With Innvil, every panel gets a free subdomain, and you can connect your own custom domain with automatic SSL — then disconnect it anytime and fall back to the subdomain. Your brand and audience move with you.",
          },
        ],
      },
      {
        h2: "So which should you choose?",
        blocks: [
          {
            kind: "ul",
            items: [
              "**Choose a script** if you're a developer, you want to own the codebase, and you're happy to run servers and security yourself.",
              "**Choose a white-label builder** if you want to launch fast, avoid maintenance, pay only when you earn, and put your energy into marketing and customers instead of DevOps.",
            ],
          },
          {
            kind: "p",
            text: "For most people starting out — and even for experienced resellers who'd rather not babysit infrastructure — the builder path wins on speed, cost, and safety.",
          },
        ],
      },
    ],
    cta: {
      heading: "Skip the server. Launch a panel today.",
      text: "Innvil is the no-code, white-label alternative to buying an SMM panel script — nothing to install, 5% on completed orders only, live in minutes.",
    },
    related: ["how-to-start-an-smm-panel", "how-much-does-an-smm-panel-cost"],
  },

  {
    slug: "how-much-does-an-smm-panel-cost",
    title: "How Much Does It Cost to Start an SMM Panel? (Real Numbers)",
    description:
      "A transparent breakdown of what it actually costs to start and run an SMM panel — provider deposits, platform fees, domains, and payments — with real example numbers for 2026.",
    date: "2026-07-23",
    readMinutes: 6,
    tag: "Pricing",
    keywords: [
      "smm panel cost",
      "how much does an smm panel cost",
      "smm panel pricing",
      "start smm panel cheap",
      "smm panel monthly fee",
    ],
    intro:
      "\"How much do I need to start?\" is the first question most people ask about SMM panels — and the answers online are all over the place. Here's a transparent breakdown of the real costs in 2026, with example numbers, so you can budget properly.",
    sections: [
      {
        h2: "The four real costs",
        blocks: [
          {
            kind: "p",
            text: "Ignore the noise — running an SMM panel comes down to four things:",
          },
          {
            kind: "ol",
            items: [
              "**Provider funds** — money you deposit with your wholesale provider to fulfil orders.",
              "**Platform cost** — the fee for the storefront itself (a licence, monthly rent, or commission).",
              "**Domain** — optional, if you want a custom domain instead of a free subdomain.",
              "**Payments** — gateway fees taken as a small percentage of deposits.",
            ],
          },
        ],
      },
      {
        h2: "1. Provider funds (your biggest lever)",
        blocks: [
          {
            kind: "p",
            text: "This is working capital, not a sunk cost — you spend it fulfilling orders that customers already paid you for. You can genuinely start with as little as $10–$50 in provider credit and grow from there, topping up as orders come in.",
          },
          {
            kind: "p",
            text: "Because customers fund their wallets before you order from your provider, a healthy panel is close to self-financing: their deposit covers the provider cost, and your markup is profit.",
          },
        ],
      },
      {
        h2: "2. Platform cost (where models differ wildly)",
        blocks: [
          {
            kind: "p",
            text: "This is the line item that varies most between options:",
          },
          {
            kind: "ul",
            items: [
              "**Self-hosted script:** a one-time licence (often $50–$300) plus ongoing hosting (~$5–$20/mo) and any developer time.",
              "**Rented hosted panels:** a fixed monthly rent, charged whether or not you sell.",
              "**Innvil:** $0 monthly rent, $0 setup — 5% commission on completed orders only, dropping toward 1% as you scale, capped at $100 per panel per day.",
            ],
          },
          {
            kind: "p",
            text: "The practical difference: with rent or a licence you pay during slow months too. With a commission you only pay when an order completes — so your platform cost tracks your revenue instead of fighting it.",
          },
        ],
      },
      {
        h2: "3. Domain (optional)",
        blocks: [
          {
            kind: "p",
            text: "Every Innvil panel includes a free subdomain, so a custom domain is optional. If you want one, expect roughly $10–$15/year from a registrar. You can connect it with automatic SSL and disconnect anytime — the storefront falls back to the subdomain, so there's no lock-in.",
          },
        ],
      },
      {
        h2: "4. Payment processing",
        blocks: [
          {
            kind: "p",
            text: "Gateways take a small percentage of each deposit. Crypto processors like Cryptomus and NOWPayments are popular in SMM for low fees and fast setup. This isn't a cost you pay up front — it comes out of customer deposits as they happen.",
          },
        ],
      },
      {
        h2: "A realistic starting budget",
        blocks: [
          {
            kind: "p",
            text: "Putting it together, a lean 2026 launch on a commission-based builder looks like:",
          },
          {
            kind: "ul",
            items: [
              "Provider deposit to get going: **$20–$50**",
              "Platform rent/setup: **$0** (you pay 5% only as orders complete)",
              "Custom domain: **$0–$15/year** (optional)",
              "Upfront total: **around $20–$65** — most of which is working capital you recover from orders.",
            ],
          },
          {
            kind: "p",
            text: "Compare that to a script (licence + server) or a rented panel (monthly rent from day one) and the commission model is the cheapest way to test whether an SMM panel works for you — because your only real spend is the provider funds you'd need regardless.",
          },
        ],
      },
    ],
    cta: {
      heading: "Start for the price of a provider top-up.",
      text: "No rent, no setup fee — build and preview your panel free, and pay just 5% on completed orders. Create your panel and see the numbers for yourself.",
    },
    related: ["how-to-start-an-smm-panel", "white-label-smm-panel-vs-smm-panel-script"],
  },
];

const bySlug = new Map(BLOG_POSTS.map((p) => [p.slug, p]));

/** Posts newest-first (by published date). */
export function allPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPost(slug: string): BlogPost | undefined {
  return bySlug.get(slug);
}

export function relatedPosts(slug: string): BlogPost[] {
  const post = bySlug.get(slug);
  if (!post?.related) return [];
  return post.related.map((s) => bySlug.get(s)).filter((p): p is BlogPost => Boolean(p));
}
