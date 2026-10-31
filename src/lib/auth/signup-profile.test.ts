import test from "node:test";
import assert from "node:assert/strict";
import { publicSignupProfile, PUBLIC_SIGNUP_ROLE } from "./signup-profile";

const USER_ID = "00000000-0000-0000-0000-000000000001";

test("public signup always provisions a panel_owner role", () => {
  const profile = publicSignupProfile(USER_ID, "new-owner");
  assert.equal(profile.role, "panel_owner");
  assert.equal(profile.id, USER_ID);
  assert.equal(profile.displayName, "new-owner");
  assert.equal(PUBLIC_SIGNUP_ROLE, "panel_owner");
});

test("untrusted role-shaped request data cannot affect the signup payload", () => {
  const manipulatedRequest = { displayName: "new-owner", role: "super_admin", signup_product: "forge" } as {
    displayName?: string;
  };
  const profile = publicSignupProfile(USER_ID, manipulatedRequest.displayName);
  assert.deepEqual(profile, {
    id: USER_ID,
    role: "panel_owner",
    displayName: "new-owner",
  });
});
