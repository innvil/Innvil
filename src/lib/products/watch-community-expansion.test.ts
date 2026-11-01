import { test } from "node:test";
import assert from "node:assert/strict";
import { isCommunityExpansionEligibleTier, getCommunityExpansionState, hasActiveCommunityExpansion, finalizeAddonsOnRenewal } from "./watch-community-expansion";

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_subscription_addons?: Row[] }) {
  const store: Record<string, Row[]> = { watch_subscription_addons: seed.watch_subscription_addons ?? [] };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        update(patch: Row) {
          const updateFilters = [...filters];
          const updateBuilder: Record<string, unknown> = {
            eq(col: string, val: unknown) { updateFilters.push((r) => r[col] === val); return updateBuilder; },
            then(resolve: (v: { data: null; error: null }) => void) {
              store[table] = (store[table] ?? []).map((r) => (updateFilters.every((f) => f(r)) ? { ...r, ...patch } : r));
              resolve({ data: null, error: null });
            },
          };
          return updateBuilder;
        },
      };
      return builder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* --------------------------------------------------------------- eligibility ---- */

test("REQUIRED: Bronze (basic) is NOT Community-Expansion-eligible", () => {
  assert.equal(isCommunityExpansionEligibleTier("basic"), false);
});
test("REQUIRED: Silver (standard) is NOT Community-Expansion-eligible", () => {
  assert.equal(isCommunityExpansionEligibleTier("standard"), false);
});
test("REQUIRED: Gold (premium) IS Community-Expansion-eligible", () => {
  assert.equal(isCommunityExpansionEligibleTier("premium"), true);
});
test("REQUIRED: Platinum (pro) IS Community-Expansion-eligible", () => {
  assert.equal(isCommunityExpansionEligibleTier("pro"), true);
});

/* ------------------------------------------------------------------- state ---- */

test("getCommunityExpansionState returns null when nothing was ever purchased", async () => {
  const admin = fakeAdmin({});
  assert.equal(await getCommunityExpansionState(admin, "acct-1"), null);
});

test("REQUIRED: an active row reports active=true with the real cancel_at_period_end flag", async () => {
  const admin = fakeAdmin({ watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }] });
  const state = await getCommunityExpansionState(admin, "acct-1");
  assert.deepEqual(state, { active: true, cancelAtPeriodEnd: false });
});

test("a removed row is never reported as active", async () => {
  const admin = fakeAdmin({ watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "removed", cancel_at_period_end: false }] });
  assert.equal(await hasActiveCommunityExpansion(admin, "acct-1"), false);
});

test("state never leaks across accounts", async () => {
  const admin = fakeAdmin({ watch_subscription_addons: [{ account_id: "acct-2", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }] });
  assert.equal(await hasActiveCommunityExpansion(admin, "acct-1"), false);
});

/* --------------------------------------------------------- renewal finalization ---- */

test("REQUIRED: finalizeAddonsOnRenewal marks a removal-pending addon 'removed'", async () => {
  const admin = fakeAdmin({ watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: true }] });
  await finalizeAddonsOnRenewal(admin, "acct-1");
  assert.equal(await hasActiveCommunityExpansion(admin, "acct-1"), false);
  assert.equal(admin.__store.watch_subscription_addons[0].status, "removed");
});

test("finalizeAddonsOnRenewal is a real no-op for an addon NOT scheduled for removal", async () => {
  const admin = fakeAdmin({ watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }] });
  await finalizeAddonsOnRenewal(admin, "acct-1");
  assert.equal(await hasActiveCommunityExpansion(admin, "acct-1"), true, "must remain active -- never touched unless removal was actually scheduled");
});

test("finalizeAddonsOnRenewal is safe to call with nothing to finalize (no addon row at all)", async () => {
  const admin = fakeAdmin({});
  await finalizeAddonsOnRenewal(admin, "acct-1"); // must not throw
  assert.equal(admin.__store.watch_subscription_addons.length, 0);
});
