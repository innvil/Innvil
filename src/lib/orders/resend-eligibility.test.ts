import assert from "node:assert/strict";
import test from "node:test";
import {
  isOrderResendEligible,
  resendRequiresCustomerRecharge,
} from "./resend-eligibility";

test("canceled and refunded orders can be resent only before a provider accepts them", () => {
  assert.equal(isOrderResendEligible({ status: "canceled", providerOrderId: null }), true);
  assert.equal(isOrderResendEligible({ status: "refunded", providerOrderId: null }), true);
  assert.equal(isOrderResendEligible({ status: "canceled", providerOrderId: "provider-123" }), false);
  assert.equal(isOrderResendEligible({ status: "refunded", providerOrderId: "provider-123" }), false);
});

test("a resend recharges only orders whose prior charge was returned", () => {
  assert.equal(resendRequiresCustomerRecharge("canceled"), true);
  assert.equal(resendRequiresCustomerRecharge("refunded"), true);
  assert.equal(resendRequiresCustomerRecharge("pending"), false);
  assert.equal(resendRequiresCustomerRecharge("duplicate"), false);
  assert.equal(resendRequiresCustomerRecharge("failed"), false);
});

test("ordinary failed orders remain protected from duplicate provider work", () => {
  assert.equal(isOrderResendEligible({ status: "failed", providerOrderId: null }), false);
  assert.equal(isOrderResendEligible({
    status: "failed",
    providerOrderId: null,
    providerErrorCategory: "provider_auth_error",
  }), true);
  assert.equal(isOrderResendEligible({
    status: "failed",
    providerOrderId: null,
    providerError: "Provider balance is insufficient",
  }), true);
});
