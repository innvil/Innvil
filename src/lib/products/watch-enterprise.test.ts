import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENTERPRISE_MODES, buildEnterpriseInquiryBody, managedEnterprisePrice, managedEnterpriseCommunities,
  WATCH_ENTERPRISE_BYO_TIERS, compareEnterpriseModesAtSlots,
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

test("buildEnterpriseInquiryBody returns the usage context unchanged for managed mode too", () => {
  const body = buildEnterpriseInquiryBody("managed", "Current plan: Gold\n");
  assert.doesNotMatch(body, /Enterprise mode:/);
  assert.equal(body, "Current plan: Gold\n");
});

test("REQUIRED: no internal ids leak into the inquiry body -- only whatever plain-text context the caller supplies", () => {
  const body = buildEnterpriseInquiryBody("managed", "");
  assert.doesNotMatch(body, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, "must never contain a UUID-shaped internal id");
});

test("REQUIRED: buildEnterpriseInquiryBody includes the ACTUAL configured Managed slot count + live-computed price/Communities when given, never a duplicated formula", () => {
  const body = buildEnterpriseInquiryBody("managed", "Current plan: Gold\n", 50);
  assert.match(body, /50 Watcher slots/);
  assert.match(body, new RegExp(`\\$${managedEnterprisePrice(50).toFixed(2)}`));
  assert.match(body, new RegExp(`${managedEnterpriseCommunities(50)} Communities included`));
  assert.match(body, /Current plan: Gold/, "still includes the base usage context, not a replacement");
});

test("buildEnterpriseInquiryBody's slot-count line is omitted for BYO mode even if a slot count is somehow passed", () => {
  const body = buildEnterpriseInquiryBody("byo", "Current plan: Platinum\n", 50);
  assert.doesNotMatch(body, /Watcher slots/);
  assert.equal(body, "Current plan: Platinum\n");
});

test("buildEnterpriseInquiryBody without a slot count (the existing 2-arg call shape) is unaffected -- backward compatible", () => {
  const body = buildEnterpriseInquiryBody("managed", "Current plan: Gold\n");
  assert.equal(body, "Current plan: Gold\n");
});

/* ==================================================== managed pricing ==== */

test("REQUIRED: managedEnterprisePrice is the SAME canonical formula as moderatorEnterpriseSlotPrice, never a duplicate", () => {
  for (const slots of [21, 30, 50, 75, 100]) {
    assert.equal(managedEnterprisePrice(slots), moderatorEnterpriseSlotPrice(slots));
  }
});

test("REQUIRED: the worked example -- 50 Watcher slots is $829.99/mo -- matches the real formula exactly (Platinum base $379.99 + 30 slots x $15)", () => {
  assert.equal(managedEnterprisePrice(50), 829.99);
});

test("REQUIRED: managedEnterpriseCommunities is the SAME canonical formula as moderatorEnterpriseIncludedCommunities", () => {
  for (const slots of [20, 25, 35, 50, 100]) {
    assert.equal(managedEnterpriseCommunities(slots), moderatorEnterpriseIncludedCommunities(slots));
  }
});

test("managedEnterpriseCommunities: 50 slots includes 8 Communities (the real formula's +30-or-more band)", () => {
  assert.equal(managedEnterpriseCommunities(50), 8);
});

/* ======================================================== byo pricing ==== */

test("REQUIRED: BYO uses the previously recorded fixed two-tier pricing (BYO 50 = $599/mo, BYO Unlimited = $799/mo) -- not a per-slot formula", () => {
  const byo50 = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_50");
  const byoUnlimited = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_unlimited");
  assert.equal(byo50?.price, 599);
  assert.equal(byo50?.maxSlots, 50);
  assert.equal(byoUnlimited?.price, 799);
  assert.equal(byoUnlimited?.maxSlots, null);
});

test("BYO tiers are strictly two -- no invented third tier", () => {
  assert.equal(WATCH_ENTERPRISE_BYO_TIERS.length, 2);
});

/* ==================================================== savings compare ==== */

test("REQUIRED: at equivalent 50-slot capacity, Managed vs BYO savings are calculated correctly, not hard-coded", () => {
  const cmp = compareEnterpriseModesAtSlots(50);
  assert.ok(cmp);
  assert.equal(cmp?.managedPrice, 829.99);
  assert.equal(cmp?.byoPrice, 599);
  assert.equal(cmp?.savingsAmount, 230.99, "829.99 - 599 = 230.99");
  // 230.99 / 829.99 = 0.27831... -> rounded to 1dp = 27.8
  assert.equal(cmp?.savingsPercent, 27.8);
});

test("REQUIRED: compareEnterpriseModesAtSlots refuses a slot count with no matching BYO tier -- never fabricates a mismatched comparison", () => {
  assert.equal(compareEnterpriseModesAtSlots(25), null, "25 slots has no BYO tier to compare against -- must not invent one");
  assert.equal(compareEnterpriseModesAtSlots(100), null, "BYO Unlimited has no slot ceiling to compare 1:1 against Managed's per-slot price");
});

test("REQUIRED: no canonical BYO price/savings figure is fabricated -- every number traces back to a real source constant", () => {
  // Cross-check the comparison against the raw formula + the raw BYO constant
  // independently, so this test would fail if either drifted from source.
  const managed50 = moderatorEnterpriseSlotPrice(50);
  const byo50 = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === "byo_50")!.price;
  const cmp = compareEnterpriseModesAtSlots(50)!;
  assert.equal(cmp.managedPrice, managed50);
  assert.equal(cmp.byoPrice, byo50);
});
