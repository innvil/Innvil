import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HELP_ARTICLES, HELP_CATEGORIES, getArticle, articlesByCategory, relatedArticles, searchArticles, popularArticles,
} from "./content";
import { TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "@/src/lib/moderator/plan";
import { MODERATOR_COMMUNITY_CAPACITY, COMMUNITY_EXPANSION_MONTHLY_PRICE, MODERATOR_AI_GENERATION_POOL, MODERATOR_MEDIA_ADDON } from "@/src/lib/money";
import { MANAGED_ENTERPRISE_50, WATCH_ENTERPRISE_BYO_TIERS } from "@/src/lib/products/watch-enterprise";

/* ------------------------------------------------------------- structure ---- */

test("REQUIRED: every article has a real, non-empty title/description/body and belongs to a real category", () => {
  const categoryIds = new Set(HELP_CATEGORIES.map((c) => c.id));
  for (const a of HELP_ARTICLES) {
    assert.ok(a.title.trim().length > 0, `${a.slug} needs a title`);
    assert.ok(a.description.trim().length > 0, `${a.slug} needs a description`);
    assert.ok(a.body.length > 0, `${a.slug} needs a real body`);
    assert.ok(categoryIds.has(a.category), `${a.slug}'s category must be a real category`);
  }
});

test("every article slug is unique", () => {
  const slugs = HELP_ARTICLES.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("REQUIRED: no article ever mentions Panel/Forge/SMM Panel", () => {
  const allText = HELP_ARTICLES.flatMap((a) => [a.title, a.description, ...a.body]).join(" ").toLowerCase();
  assert.ok(!allText.includes("panel"), "no article should mention Panel");
  assert.ok(!allText.includes("forge"), "no article should mention Forge");
  assert.ok(!allText.includes("smm panel"), "no article should mention SMM Panel");
});

/* --------------------------------------------------------------- lookups ---- */

test("getArticle resolves a real article by slug, null for an unknown one", () => {
  assert.ok(getArticle("what-is-a-watcher"));
  assert.equal(getArticle("does-not-exist"), null);
});

test("REQUIRED: category navigation resolves the real set of articles for each category", () => {
  for (const cat of HELP_CATEGORIES) {
    const articles = articlesByCategory(cat.id);
    assert.ok(articles.every((a) => a.category === cat.id));
  }
  // At least one real article exists for the categories this pass actually populated.
  assert.ok(articlesByCategory("watchers").length > 0);
  assert.ok(articlesByCategory("troubleshooting").length > 0);
});

test("REQUIRED: related-article links resolve to real articles, never a dangling slug", () => {
  for (const a of HELP_ARTICLES) {
    const related = relatedArticles(a);
    assert.equal(related.length, a.related.length, `${a.slug} has a related slug that doesn't resolve to a real article`);
  }
});

test("REQUIRED: popular articles all resolve to real articles", () => {
  const popular = popularArticles();
  assert.ok(popular.length > 0);
  assert.ok(popular.every((a) => HELP_ARTICLES.includes(a)));
});

/* ---------------------------------------------------------------- search ---- */

test("REQUIRED: search for 'watcher' 'slot' returns the real slot article near the top", () => {
  const results = searchArticles("watcher slot");
  assert.ok(results.length > 0);
  assert.ok(results.some((a) => a.slug === "watcher-profiles-deployments-slots"));
});

test("REQUIRED: search for 'free trial' returns the trial article", () => {
  const results = searchArticles("free trial");
  assert.ok(results.some((a) => a.slug === "start-the-free-trial"));
});

test("REQUIRED: search for 'credit' returns the Innvil Credit article", () => {
  const results = searchArticles("credit");
  assert.ok(results.some((a) => a.slug === "innvil-credit"));
});

test("REQUIRED: search for 'community expansion' returns that article", () => {
  const results = searchArticles("community expansion");
  assert.ok(results.some((a) => a.slug === "community-expansion"));
});

test("REQUIRED: search does not return unrelated articles for a specific, narrow query", () => {
  const results = searchArticles("innvil credit");
  assert.ok(!results.some((a) => a.slug === "watcher-not-responding"), "an unrelated troubleshooting article must not match a specific billing query");
});

test("an empty/whitespace query returns no results, never the whole catalog", () => {
  assert.deepEqual(searchArticles(""), []);
  assert.deepEqual(searchArticles("   "), []);
});

test("a query with zero real overlap returns nothing", () => {
  assert.deepEqual(searchArticles("xyzzy-nonsense-query"), []);
});

/* ---------------------------------------------------- canonical accuracy ---- */

test("REQUIRED: the Free Trial article uses the real canonical trial duration/slot/community values", () => {
  const a = getArticle("start-the-free-trial")!;
  const text = a.body.join(" ");
  assert.ok(text.includes(String(TRIAL_DURATION_DAYS)));
  assert.ok(text.includes(String(TRIAL_CAPACITY.maxActiveSlots)));
  assert.ok(text.includes(String(TRIAL_CAPACITY.maxCommunities)));
});

test("REQUIRED: Innvil Credit article states the correct 1:1 USD service-credit semantics", () => {
  const a = getArticle("innvil-credit")!;
  const text = a.description + " " + a.body.join(" ");
  assert.ok(text.includes("1 Innvil Credit = $1.00 USD"));
  assert.ok(text.toLowerCase().includes("non-transferable"));
  assert.ok(text.toLowerCase().includes("non-withdrawable"));
});

test("REQUIRED: Community Expansion docs mention ONLY Gold and Platinum -- never Bronze/Silver as eligible", () => {
  const a = getArticle("community-expansion")!;
  const text = a.body.join(" ");
  assert.ok(text.includes("Gold"));
  assert.ok(text.includes("Platinum"));
  assert.ok(!/bronze (can|is) (purchase|eligible)/i.test(text));
  assert.ok(text.includes(`$${COMMUNITY_EXPANSION_MONTHLY_PRICE.premium.toFixed(2)}`));
  assert.ok(text.includes(`$${COMMUNITY_EXPANSION_MONTHLY_PRICE.pro.toFixed(2)}`));
});

test("Community capacity article's included-per-plan numbers match the canonical MODERATOR_COMMUNITY_CAPACITY table", () => {
  const a = getArticle("community-capacity")!;
  const text = a.body.join(" ");
  assert.ok(text.includes(String(MODERATOR_COMMUNITY_CAPACITY.basic.included)));
  assert.ok(text.includes(String(MODERATOR_COMMUNITY_CAPACITY.premium.included)));
});

test("REQUIRED: the Innvil Watch Enterprise article states the real, current fixed pricing for all three packages", () => {
  const a = getArticle("innvil-watch-enterprise")!;
  const text = a.body.join(" ");
  assert.ok(text.includes(`$${MANAGED_ENTERPRISE_50.price.toFixed(2)}`), "Managed Enterprise 50's real price");
  assert.ok(text.includes(String(MANAGED_ENTERPRISE_50.slots)), "Managed Enterprise 50's real slot count");
  assert.ok(text.includes(MANAGED_ENTERPRISE_50.aiGenerations.toLocaleString()), "Managed Enterprise 50's real pooled AI Generations figure");
  assert.ok(text.includes(`$${WATCH_ENTERPRISE_BYO_TIERS[0].price}`), "BYO 50's real price");
  assert.ok(text.includes(`$${WATCH_ENTERPRISE_BYO_TIERS[1].price}`), "BYO Unlimited's real price");
  assert.doesNotMatch(text, /\$599|\$799|\$829\.99/, "must never state the superseded pre-repricing figures");
});

test("REQUIRED: Plans and Billing article states the real per-tier AI Generations allowances and Media Moderation + pricing", () => {
  const a = getArticle("plans-and-billing")!;
  const text = a.body.join(" ");
  assert.ok(text.includes(MODERATOR_AI_GENERATION_POOL.basic.toLocaleString()));
  assert.ok(text.includes(MODERATOR_AI_GENERATION_POOL.pro.toLocaleString()));
  assert.ok(text.includes(`$${MODERATOR_MEDIA_ADDON.basic.price.toFixed(2)}`));
  assert.ok(text.includes(`$${MODERATOR_MEDIA_ADDON.pro.price.toFixed(2)}`));
});

test("REQUIRED: Plans and Billing article correctly states annual billing has TWO real discounts (5% direct, 10% Innvil Credit) -- never the superseded 'Innvil Credit only' claim", () => {
  const a = getArticle("plans-and-billing")!;
  const text = a.body.join(" ");
  assert.ok(text.includes("5%"), "must state the real 5% direct-payment annual discount");
  assert.ok(text.includes("10%"), "must state the real 10% Innvil Credit annual discount");
  assert.ok(!/Innvil Credit only/i.test(text), "annual is no longer Innvil-Credit-exclusive as of 2026-08-25");
});

test("REQUIRED: Innvil Credit article no longer claims annual billing is Innvil-Credit-exclusive", () => {
  const a = getArticle("innvil-credit")!;
  const text = a.body.join(" ");
  assert.ok(!/annual billing is Innvil Credit only/i.test(text));
  assert.ok(text.includes("5%") && text.includes("10%"), "must state both real annual discount rates");
});

/* ------------------------------------------------- product documentation system ---- */

test("REQUIRED: every new documentation category is populated -- no dead/empty category in the nav", () => {
  for (const id of ["concepts", "knowledge", "moderation", "escalation", "dashboard", "faq"] as const) {
    assert.ok(articlesByCategory(id).length > 0, `category "${id}" must have at least one real article`);
  }
});

test("REQUIRED: the Escalation Group Slot Rule article states the exact rule and every worked example from the spec", () => {
  const a = getArticle("escalation-group-slot-rule")!;
  const text = a.body.join(" ");
  assert.match(text, /1 Watcher Slot = 1 active Watcher × 1 deployed customer-facing Community/);
  assert.match(text, /Community 1 = 1 slot/);
  assert.match(text, /Community 1 and Community 2 = 2 slots/);
  assert.match(text, /both deployed to Community 1 = 2 slots/);
  assert.match(text, /Escalation Group = still 1 slot/);
  assert.match(text, /3 slots, not 6/);
});

test("REQUIRED: Watcher Slots and Billing states the real formula and all four worked examples", () => {
  const a = getArticle("watcher-slots-and-billing")!;
  const text = a.body.join(" ");
  assert.match(text, /Watcher Slot Usage = Active Watcher × Active Customer-Facing Community Deployment/);
  assert.match(text, /1 Watcher, 1 Community = 1 slot/);
  assert.match(text, /1 Watcher, 3 Communities = 3 slots/);
  assert.match(text, /3 Watchers, 1 Community = 3 slots/);
  assert.match(text, /= 3 slots\. All three also connected to one private Escalation Group = still 3 slots/);
});

test("REQUIRED: the FAQ states an Escalation Group never consumes a slot, in exactly that framing", () => {
  const a = getArticle("faq")!;
  const text = a.body.join(" ");
  assert.match(text, /Does an Escalation Group consume a slot\? No\./);
});

test("REQUIRED: escalation docs never claim unbuilt capabilities as real -- duplicate merging, admin routing, priority levels, and named roles are explicitly marked not-yet-available", () => {
  const a = getArticle("escalation-roadmap")!;
  const text = a.body.join(" ").toLowerCase();
  assert.match(text, /isn't available yet/);
  assert.ok(text.includes("duplicate escalation merging"));
  assert.ok(text.includes("topic-based admin routing"));
  assert.ok(text.includes("priority/urgency levels"));
  assert.ok(text.includes("named authorization role system"));
});

test("REQUIRED: the escalation lifecycle example matches the real implemented behavior (forwarded text, resolve-back wording)", () => {
  const smart = getArticle("smart-escalation")!;
  const admin = getArticle("admin-responses")!;
  assert.match(smart.body.join(" "), /forwarded this to the team for clarification/);
  assert.match(admin.body.join(" "), /Update from the team: Distribution is scheduled for September 12\./);
});

test("REQUIRED: the dashboard tour never invents escalation statuses beyond the real Open\\/Answered model", () => {
  const a = getArticle("dashboard-tour")!;
  const text = a.body.join(" ").toLowerCase();
  assert.ok(!text.includes("waiting") && !text.includes("high-volume") && !text.includes("expired"));
  assert.ok(text.includes("isn't available yet"), "must honestly disclose analytics isn't a real feature yet");
});

test("core-concepts glossary defines every term the terminology rules require", () => {
  const a = getArticle("core-concepts")!;
  const text = a.body.join(" ");
  for (const term of ["Watcher —", "Watcher Record —", "Community —", "Deployment —", "Watcher Slot —", "Escalation Group —", "Authorized Admin —", "Escalation —", "Approved Knowledge —"]) {
    assert.ok(text.includes(term), `core-concepts must define "${term.replace(" —", "")}"`);
  }
});

test("Watch is positioned as a Virtual Moderator platform, never primarily as a bot", () => {
  const a = getArticle("what-is-innvil-watch")!;
  const text = a.body.join(" ");
  assert.match(text, /Virtual Moderators/);
  assert.doesNotMatch(text, /\bbot\b/i, "the platform-level pitch should not lead with 'bot' as the category");
});

test("REQUIRED: search surfaces the new escalation and slot-billing content for real queries", () => {
  assert.ok(searchArticles("escalation group slot").some((a) => a.slug === "escalation-group-slot-rule"));
  assert.ok(searchArticles("smart escalation").some((a) => a.slug === "smart-escalation"));
  assert.ok(searchArticles("persona role").some((a) => a.slug === "personas-and-roles"));
});

test("REQUIRED: getting-started-path lays out the exact 8-step sequence from the spec", () => {
  const a = getArticle("getting-started-path")!;
  const text = a.body.join(" ");
  for (const step of ["Create a Watcher", "Configure its persona", "Add Project Knowledge", "Configure moderation", "Deploy to a Telegram Community", "Connect an Escalation Group", "Test it", "Go live"]) {
    assert.ok(text.includes(step), `getting-started-path must include step "${step}"`);
  }
});

test("REQUIRED: Watcher Ops Moderation Reports article states deterministic/no-AI-usage, real-outcome, shared-state, dedup, and Free Trial inclusion", () => {
  const a = getArticle("watcher-ops-moderation-reports")!;
  const text = a.body.join(" ");
  assert.match(text, /built from templates, not written by a model/i);
  assert.match(text, /never count toward your account's AI Generations usage/i);
  assert.match(text, /reflect ACTUAL outcomes, never an assumed one/i);
  assert.match(text, /belongs to the Community they're in, not to whichever specific Watcher/i);
  assert.match(text, /only one of them acts on and reports any given violation/i);
  assert.match(text, /available on the Free Trial too/i);
});

test("REQUIRED: Watcher Ops / Escalation Group article distinguishes Knowledge Escalation from Moderation Action reports, and states it's optional but strongly recommended", () => {
  const a = getArticle("watcher-ops-escalation-group")!;
  const text = a.body.join(" ");
  assert.match(text, /Knowledge Escalation/);
  assert.match(text, /Moderation Action report/);
  assert.match(text, /strongly recommended/i);
  assert.match(text, /it's optional/i);
});
