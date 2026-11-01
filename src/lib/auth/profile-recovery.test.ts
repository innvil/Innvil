import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrustedProfileRole, trustedRoleIntentFromAppMetadata } from "./profile-recovery";

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
  assert.equal(trustedRoleIntentFromAppMetadata({ profile_role_intent: "panel_owner" }), "panel_owner");
  assert.equal(trustedRoleIntentFromAppMetadata({ profile_role_intent: "customer" }), "customer");
  assert.equal(trustedRoleIntentFromAppMetadata({ profile_role_intent: "super_admin" }), null);
  assert.equal(trustedRoleIntentFromAppMetadata({ role: "super_admin" }), null);
  assert.equal(trustedRoleIntentFromAppMetadata(null), null);
});
