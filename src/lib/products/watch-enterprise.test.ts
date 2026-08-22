import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENTERPRISE_MODES, buildEnterpriseInquiryBody, managedEnterprisePrice, managedEnterpriseCommunities,
  WATCH_ENTERPRISE_BYO_TIERS, compareEnterpriseModesAtSlots, MANAGED_ENTERPRISE_50,
  enterpriseMediaAddon, enterprisePackageTotalWithMedia,
} from "./watch-enterprise";
import { moderatorEnterpriseSlotPrice, moderatorEnterpriseIncludedCommunities } from "@/src/lib/money";

/**
 * Innvil Watch Enterprise — Managed vs. Bring Your Own Provider. Managed
 * pricing is a REAL live formula (money.ts); BYO pricing is the fixed
 * two-tier model promoted from CLAUDE.md's Phase 4.S planning note this
 * pass. No other price/percentage may ever be fabricated.
 */

test("REQUIRED: exactly two Enterprise modes exist -- managed and byo, no others", () => {
  assert.deepEqual(Object.keys(ENTERPRISE_MODES).sort(), ["byo", "managed"]);
});

test("REQUIRED: neither mode is represented as a separate product -- both inquiry subjects say 'Innvil Watch Enterprise'", () => {
  for (const meta of Object.values(ENTERPRISE_MODES)) {
    assert.match(meta.inquirySubject, /^Innvil Watch Enterprise —/);
  }
});

test("REQUIRED: Managed and BYO have distinct, correctly-labeled inquiry subjects", () => {
  assert.equal(ENTERPRISE_MODES.managed.inquirySubject, "Innvil Watch Enterprise — Managed");
  assert.equal(ENTERPRISE_MODES.byo.inquirySubject, "Innvil Watch Enterprise — Bring Your Own Provider");
});

test("REQUIRED: buildEnterpriseInquiryBody does NOT restate the mode label -- the inquiry subject already says it, and repeating it in the body is redundant", () => {
  // Confirmed via a live screenshot: the subject "Innvil Watch Enterprise —
  // Bring Your Own Provider" immediately followed by a body starting
  // "Enterprise mode: Bring Your Own Provider" read as duplicated noise.
  const body = buildEnterpriseInquiryBody("byo", "Current plan: Platinum\nWatcher slots used: 18/20\n");
  assert.doesNotMatch(body, /Enterprise mode:/);
  assert.match(body, /^Current plan: Platinum/);
  assert.match(body, /Watcher slots used: 18\/20/);
});

test("REQUIRED: no internal ids leak into the inquiry body -- only whatever plain-text context the caller supplies", () => {
  const body = buildEnterpriseInquiryBody("managed", "");
  assert.doesNotMatch(body, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, "must never contain a UUID-shaped internal id");
});

test("REQUIRED: buildEnterpriseInquiryBody defaults to the FIXED Managed Enterprise 50 package when no custom slot count is given", () => {
  const body = buildEnterpriseInquiryBody("managed", "Current plan: Gold\n");
  assert.match(body, new RegExp(`${MANAGED_ENTERPRISE_50.slots} Watcher slots`));
  assert.match(body, new RegExp(`\\$${MANAGED_ENTERPRISE_50.price.toFixed(2)}`));
  assert.match(body, new RegExp(`${MANAGED_ENTERPRISE_50.communities} Communities included`));
  assert.match(body, new RegExp(`${MANAGED_ENTERPRISE_50.aiGenerations.toLocaleString()} pooled AI Generations`));
  assert.match(body, /Current plan: Gold/, "still includes the base usage context, not a replacement");
});

test("REQUIRED: buildEnterpriseInquiryBody switches to a CUSTOM quote line only when the configured slots exceed the fixed 50-slot package", () => {
  const body = buildEnterpriseInquiryBody("managed", "Current plan: Gold\n", 75);
  assert.match(body, /CUSTOM Managed Enterprise capacity: 75 Watcher slots/);
  assert.match(body, new RegExp(`\\$${managedEnterprisePrice(75).toFixed(2)}`));
  assert.match(body, new RegExp(`${managedEnterpriseCommunities(75)} Communities included`));
});

test("buildEnterpriseInquiryBody at exactly 50 slots still resolves to the FIXED package line, not the custom-quote line", () => {
  const body = buildEnterpriseInquiryBody("managed", "Current plan: Gold\n", 50);
  assert.doesNotMatch(body, /CUSTOM/);
  assert.match(body, new RegExp(`\\$${MANAGED_ENTERPRISE_50.price.toFixed(2)}`));
});

test("buildEnterpriseInquiryBody's slot-count line is omitted for BYO mode even if a slot count is somehow passed", () => {
  const body = buildEnterpriseInquiryBody("byo", "Current plan: Platinum\n", 75);
  assert.doesNotMatch(body, /Watcher slots/);
  assert.equal(body, "Current plan: Platinum\n");
});

/* ==================================================== managed pricing ==== */

test("REQUIRED: Managed Enterprise 50 is a FIXED $399/mo package, not the dynamic per-slot formula", () => {
  assert.equal(MANAGED_ENTERPRISE_50.price, 399);
  assert.equal(MANAGED_ENTERPRISE_50.slots, 50);
  assert.notEqual(MANAGED_ENTERPRISE_50.price, moderatorEnterpriseSlotPrice(50), "the fixed package must not equal the superseded dynamic formula's value at 50 slots");
});

test("REQUIRED: Managed Enterprise 50's AI Generation pool is 50,000/mo, account-pooled (a single number, never multiplied per slot)", () => {
  assert.equal(MANAGED_ENTERPRISE_50.aiGenerations, 50000);
});

test("REQUIRED: Managed Enterprise 50's Community count is still sourced from the real canonical formula at 50 slots", () => {
  assert.equal(MANAGED_ENTERPRISE_50.communities, moderatorEnterpriseIncludedCommunities(50));
  assert.equal(MANAGED_ENTERPRISE_50.communities, 8);
});

test("managedEnterprisePrice (the dynamic formula) remains available for a CUSTOM quote above 50 slots", () => {
  for (const slots of [51, 75, 100]) {
    assert.equal(managedEnterprisePrice(slots), moderatorEnterpriseSlotPrice(slots));
  }
});

test("managedEnterpriseCommunities remains the same canonical formula for a custom quote", () => {
  for (const slots of [51, 75, 100]) {
    assert.equal(managedEnterpriseCommunities(slots), moderatorEnterpriseIncludedCommunities(slots));
  }
});

/* ======================================================== byo pricing ==== */

test("REQUIRED: BYO uses the repriced fixed two-tier pricing (BYO 50 = $299/mo, BYO Unlimited = $499/mo) -- not a per-slot formula", () => {
  const byo50 = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_50");
  const byoUnlimited = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_unlimited");
  assert.equal(byo50?.price, 299);
  assert.equal(byo50?.maxSlots, 50);
  assert.equal(byoUnlimited?.price, 499);
  assert.equal(byoUnlimited?.maxSlots, null);
});

test("BYO tiers are strictly two -- no invented third tier", () => {
  assert.equal(WATCH_ENTERPRISE_BYO_TIERS.length, 2);
});

/* ============================================== media moderation + ==== */

test("REQUIRED: Media Moderation + pricing/units per fixed Enterprise package", () => {
  assert.deepEqual(enterpriseMediaAddon("managed50"), { price: 39.99, units: 8000 });
  assert.deepEqual(enterpriseMediaAddon("byo50"), { price: 39.99, units: 8000 });
  assert.deepEqual(enterpriseMediaAddon("byoUnlimited"), { price: 49.99, units: 10000 });
});

test("REQUIRED: every fixed Enterprise package works as a real, complete offering WITHOUT the Media Moderation + add-on enabled", () => {
  assert.equal(MANAGED_ENTERPRISE_50.price, 399);
  assert.equal(WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_50")?.price, 299);
  assert.equal(WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_unlimited")?.price, 499);
});

test("REQUIRED: enterprisePackageTotalWithMedia sums base + add-on correctly, matching the worked examples", () => {
  assert.equal(enterprisePackageTotalWithMedia(399, "managed50"), 438.99);
  assert.equal(enterprisePackageTotalWithMedia(299, "byo50"), 338.99);
  assert.equal(enterprisePackageTotalWithMedia(499, "byoUnlimited"), 548.99);
});

/* ==================================================== savings compare ==== */

test("REQUIRED: at equivalent 50-slot capacity, Managed vs BYO savings compare against the FIXED $399 Managed price, not the superseded formula", () => {
  const cmp = compareEnterpriseModesAtSlots(50);
  assert.ok(cmp);
  assert.equal(cmp?.managedPrice, 399);
  assert.equal(cmp?.byoPrice, 299);
  assert.equal(cmp?.savingsAmount, 100, "399 - 299 = 100");
  // 100 / 399 = 0.25062... -> rounded to 1dp = 25.1
  assert.equal(cmp?.savingsPercent, 25.1);
});

test("REQUIRED: compareEnterpriseModesAtSlots refuses a slot count with no matching BYO tier -- never fabricates a mismatched comparison", () => {
  assert.equal(compareEnterpriseModesAtSlots(25), null, "25 slots has no BYO tier to compare against -- must not invent one");
  assert.equal(compareEnterpriseModesAtSlots(100), null, "BYO Unlimited has no slot ceiling to compare 1:1 against Managed's per-slot price");
});

test("REQUIRED: no canonical BYO price/savings figure is fabricated -- every number traces back to a real source constant", () => {
  const byo50 = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_50")!.price;
  const cmp = compareEnterpriseModesAtSlots(50)!;
  assert.equal(cmp.managedPrice, MANAGED_ENTERPRISE_50.price);
  assert.equal(cmp.byoPrice, byo50);
});
