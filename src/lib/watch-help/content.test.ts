import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HELP_ARTICLES, HELP_CATEGORIES, getArticle, articlesByCategory, relatedArticles, searchArticles, popularArticles,
} from "./content";
import { TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "@/src/lib/moderator/plan";
import { MODERATOR_COMMUNITY_CAPACITY, COMMUNITY_EXPANSION_MONTHLY_PRICE } from "@/src/lib/money";

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
