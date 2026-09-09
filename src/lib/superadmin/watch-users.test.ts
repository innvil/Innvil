import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeWatchUsersQuery, watchUserStatus } from "./watch-users";
import { loadWatchUsersForActor } from "./watch-users-server";
import { signupProductForHost } from "../auth/signup-product";
import { WATCH_ROOT_DOMAIN } from "../config";

function fake(role: string | null, response: unknown = { data: { users: [], total: 0, summary: {} }, error: null }, roleError = false) {
  const calls: unknown[] = [];
  const query = { select: () => query, eq: (_: string, id: string) => { calls.push(id); return query; }, maybeSingle: async () => ({ data: role ? { role } : null, error: roleError ? {} : null }) };
  const admin = { from: () => query, rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return response; } } as unknown as SupabaseClient;
  return { admin, calls };
}

test("Watch directory denies anonymous, non-super-admin and failed role lookup before RPC", async () => {
  for (const [actor, role, roleError] of [[null, "super_admin", false], ["member", "panel_owner", false], ["admin", "super_admin", true]] as const) {
    const f = fake(role, undefined, roleError);
    assert.equal((await loadWatchUsersForActor(f.admin, actor)).ok, false);
    assert.equal(f.calls.some(c => typeof c === "object"), false);
  }
});
test("Watch directory binds validated actor, clamps pagination and treats search as literal data", async () => {
  const f = fake("super_admin");
  assert.equal((await loadWatchUsersForActor(f.admin, "real-actor", { search: "  '; DROP TABLE profiles; --  ", page: -5, recentDays: 365 })).ok, true);
  assert.deepEqual(f.calls[1], { name: "superadmin_watch_users", args: { p_actor: "real-actor", p_search: "'; DROP TABLE profiles; --", p_page: 1, p_page_size: 25, p_recent_days: 0 } });
  assert.deepEqual(normalizeWatchUsersQuery(null as never), { search: "", page: 1, recentDays: 0 });
  assert.deepEqual(normalizeWatchUsersQuery({ search: "x".repeat(200), page: Infinity, recentDays: 7 }), { search: "x".repeat(120), page: 1, recentDays: 7 });
  assert.equal(normalizeWatchUsersQuery({ page: 100001 }).page, 100000);
});
test("Watch directory reports missing migration and errors rather than zero users or internal details", async () => {
  for (const code of ["PGRST202", "42883", "XX000"]) {
    const f = fake("super_admin", { data: null, error: { code, message: "private database internals" } });
    const result = await loadWatchUsersForActor(f.admin, "admin");
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.error.includes("0130"), code !== "XX000"); assert.equal(result.error.includes("private"), false); }
  }
  assert.equal((await loadWatchUsersForActor(fake("super_admin", { data: {}, error: null }).admin, "admin")).ok, false);
});
test("signup product marker only recognizes exact Watch host and does not confer access", () => {
  assert.equal(signupProductForHost(WATCH_ROOT_DOMAIN), "watch");
  assert.equal(signupProductForHost(`${WATCH_ROOT_DOMAIN.toUpperCase()}:443`), "watch");
  for (const host of ["", "innvil.cloud", `${WATCH_ROOT_DOMAIN}.evil.test`, `${WATCH_ROOT_DOMAIN},evil.test`, `evil.${WATCH_ROOT_DOMAIN}`]) assert.equal(signupProductForHost(host), "innvil");
});
test("Watch status distinguishes manual grants and inactive accounts", () => {
  assert.equal(watchUserStatus({ accessStatus: "subscription", manualGrant: true }), "Active · manual grant");
  assert.equal(watchUserStatus({ accessStatus: "trial", manualGrant: false }), "Active trial");
  assert.equal(watchUserStatus({ accessStatus: "onboarding", manualGrant: false }), "No active direct subscription/trial");
});
