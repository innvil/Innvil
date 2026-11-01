import { test } from "node:test";
import assert from "node:assert/strict";
import { getMediaModerationAddonState, hasActiveMediaModerationAddon } from "./watch-media-moderation-addon";
import { MODERATOR_MEDIA_ADDON, moderatorPlanTotalWithMediaAddon } from "@/src/lib/money";

type Row = Record<string, unknown>;

function fakeAdmin(rows: Row[]) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        async maybeSingle() {
          if (table !== "watch_subscription_addons") return { data: null, error: null };
          const match = rows.find((r) => filters.every((f) => f(r)));
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* -------------------------------------------------- pricing constants ---- */

test("REQUIRED: Media Moderation + pricing/units per self-serve tier", () => {
  assert.deepEqual(MODERATOR_MEDIA_ADDON.basic, { price: 9.99, units: 1000 });
  assert.deepEqual(MODERATOR_MEDIA_ADDON.standard, { price: 14.99, units: 2000 });
  assert.deepEqual(MODERATOR_MEDIA_ADDON.premium, { price: 19.99, units: 3000 });
  assert.deepEqual(MODERATOR_MEDIA_ADDON.pro, { price: 24.99, units: 4000 });
});

test("REQUIRED: moderatorPlanTotalWithMediaAddon matches the exact worked totals (repriced base + addon)", () => {
  assert.equal(moderatorPlanTotalWithMediaAddon("basic"), 39.98);
  assert.equal(moderatorPlanTotalWithMediaAddon("standard"), 74.98);
  assert.equal(moderatorPlanTotalWithMediaAddon("premium"), 119.98);
  assert.equal(moderatorPlanTotalWithMediaAddon("pro"), 174.98);
});

/* --------------------------------------------------------- entitlement ---- */

test("REQUIRED: no active row -> null (never fabricated)", async () => {
  const admin = fakeAdmin([]);
  assert.equal(await getMediaModerationAddonState(admin, "acct-1", "basic"), null);
  assert.equal(await hasActiveMediaModerationAddon(admin, "acct-1"), false);
});

test("REQUIRED: an active row resolves to the real allowance for the account's CURRENT tier", async () => {
  const admin = fakeAdmin([
    { account_id: "acct-1", addon_type: "media_moderation", status: "active", cancel_at_period_end: false },
  ]);
  const state = await getMediaModerationAddonState(admin, "acct-1", "premium");
  assert.deepEqual(state, { active: true, cancelAtPeriodEnd: false, units: 3000 });
  assert.equal(await hasActiveMediaModerationAddon(admin, "acct-1"), true);
});

test("a scheduled-for-removal row still reads as active (cancelAtPeriodEnd surfaces the pending state, never hides it early)", async () => {
  const admin = fakeAdmin([
    { account_id: "acct-1", addon_type: "media_moderation", status: "active", cancel_at_period_end: true },
  ]);
  const state = await getMediaModerationAddonState(admin, "acct-1", "basic");
  assert.equal(state?.active, true);
  assert.equal(state?.cancelAtPeriodEnd, true);
});

test("a removed row never resolves as active", async () => {
  const admin = fakeAdmin([
    { account_id: "acct-1", addon_type: "media_moderation", status: "removed", cancel_at_period_end: false },
  ]);
  assert.equal(await getMediaModerationAddonState(admin, "acct-1", "basic"), null);
});

test("a different account's active row never leaks in -- cross-account isolation", async () => {
  const admin = fakeAdmin([
    { account_id: "acct-OTHER", addon_type: "media_moderation", status: "active", cancel_at_period_end: false },
  ]);
  assert.equal(await getMediaModerationAddonState(admin, "acct-1", "basic"), null);
});

test("REQUIRED: an active Community Expansion row of the SAME account never counts as an active Media Moderation + row -- the two add-on types are structurally independent", async () => {
  const admin = fakeAdmin([
    { account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false },
  ]);
  assert.equal(await getMediaModerationAddonState(admin, "acct-1", "premium"), null);
  assert.equal(await hasActiveMediaModerationAddon(admin, "acct-1"), false);
});

test("units resolve per the CALLER-supplied current tier, not any tier stored on the row itself (the row carries no tier field at all)", async () => {
  const admin = fakeAdmin([
    { account_id: "acct-1", addon_type: "media_moderation", status: "active", cancel_at_period_end: false },
  ]);
  const asBasic = await getMediaModerationAddonState(admin, "acct-1", "basic");
  const asPro = await getMediaModerationAddonState(admin, "acct-1", "pro");
  assert.equal(asBasic?.units, 1000);
  assert.equal(asPro?.units, 4000);
});
