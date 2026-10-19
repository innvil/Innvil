import type { OrderStatus } from "@/src/types/db";

/**
 * A resend can never be used to submit an order a provider has already accepted.
 * Canceled and refunded orders are safe to retry because their original charge was
 * returned to the customer's balance; retrying them must charge that amount again.
 */
export function resendRequiresCustomerRecharge(status: OrderStatus): boolean {
  return status === "canceled" || status === "refunded";
}

const PROVIDER_AUTH_FAILURE_RE = /provider authentication failed|invalid api|api key|unauthorized|authori[sz]ed|access denied|permission/i;
const PROVIDER_BALANCE_FAILURE_RE = /provider balance|insufficient.*balance|balance.*insufficient|low balance|not enough balance/i;

export interface ResendEligibilityInput {
  status: OrderStatus;
  providerOrderId: string | null;
  providerErrorCategory?: string | null;
  providerError?: string | null;
}

/**
 * Failed orders remain intentionally narrow: only provider authentication or
 * provider-balance failures can be retried. That prevents a manual resend from
 * duplicating work after an unknown provider failure.
 */
export function isOrderResendEligible({
  status,
  providerOrderId,
  providerErrorCategory,
  providerError,
}: ResendEligibilityInput): boolean {
  if (providerOrderId) return false;
  if (status === "pending" || status === "duplicate" || resendRequiresCustomerRecharge(status)) return true;
  if (status !== "failed") return false;

  return (
    providerErrorCategory === "provider_auth_error" ||
    providerErrorCategory === "provider_low_balance" ||
    PROVIDER_AUTH_FAILURE_RE.test(providerError ?? "") ||
    PROVIDER_BALANCE_FAILURE_RE.test(providerError ?? "")
  );
}
