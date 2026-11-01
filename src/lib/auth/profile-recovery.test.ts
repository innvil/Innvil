import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectProfileRoleIntent,
  profileRoleIntentMetadata,
  resolveTrustedProfileRole,
  trustedRoleIntentFromAppMetadata,
} from "./profile-recovery";

test("trusted customer evidence recovers only customer", () => {
  assert.deepEqual(resolveTrustedProfileRole({ hasCustomerAccount: true, ownsPanel: false, isPanelMember: false }), {
    ok: true,
    role: "customer",
  });
});

test("trusted ownership evidence recovers only panel_owner", () => {
  assert.deepEqual(resolveTrustedProfileRole({ hasCustomerAccount: false, ownsPanel: true, isPanelMember: false }), {
    ok: true,
    role: "panel_owner",
  });
});

test("trusted membership evidence recovers only staff", () => {
  assert.deepEqual(resolveTrustedProfileRole({ hasCustomerAccount: false, ownsPanel: false, isPanelMember: true }), {
    ok: true,
    role: "staff",
  });
});

test("unknown or conflicting evidence fails closed", () => {
  assert.deepEqual(resolveTrustedProfileRole({ hasCustomerAccount: false, ownsPanel: false, isPanelMember: false }), {
    ok: false,
    reason: "role_unverified",
  });
  assert.deepEqual(resolveTrustedProfileRole({ hasCustomerAccount: true, ownsPanel: true, isPanelMember: false }), {
    ok: false,
    reason: "conflicting_role_evidence",
  });
});

test("only the server-written recoverable app metadata marker is accepted", () => {
  const now = Date.now();
  assert.equal(trustedRoleIntentFromAppMetadata(profileRoleIntentMetadata("panel_owner", now)), "panel_owner");
  assert.equal(trustedRoleIntentFromAppMetadata(profileRoleIntentMetadata("customer", now)), "customer");
  assert.equal(trustedRoleIntentFromAppMetadata({
    profile_role_intent: "super_admin",
    profile_role_intent_expires_at: "2099-01-01T00:00:00.000Z",
  }), null);
  assert.equal(trustedRoleIntentFromAppMetadata({ role: "super_admin" }), null);
  assert.equal(trustedRoleIntentFromAppMetadata(null), null);
});

test("role-intent markers expire and malformed markers fail closed", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.deepEqual(inspectProfileRoleIntent(
    profileRoleIntentMetadata("customer", now - 25 * 60 * 60 * 1000),
    now,
  ), { ok: false, reason: "expired" });
  assert.deepEqual(inspectProfileRoleIntent({ profile_role_intent: "customer" }, now), {
    ok: false,
    reason: "malformed",
  });
  assert.deepEqual(inspectProfileRoleIntent({
    profile_role_intent: "super_admin",
    profile_role_intent_expires_at: "2099-01-01T00:00:00.000Z",
  }, now), { ok: false, reason: "malformed" });
});
