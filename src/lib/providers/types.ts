/* =========================================================
   Standard "SMM Panel API v2" contract.
   Requests: POST x-www-form-urlencoded with `key`, `action`, and params.
   Responses are JSON; numeric fields commonly arrive as strings.
   ========================================================= */

export interface ProviderCredentials {
  apiUrl: string;
  apiKey: string;
}

/** A service as returned by `action=services`. */
export interface ProviderServiceDTO {
  service: string | number;
  name: string;
  type: string;
  category: string;
  rate: string; // price per 1000
  min: string;
  max: string;
  refill?: boolean;
  cancel?: boolean;
  dripfeed?: boolean;
}

export type AddOrderResponse = { order: number | string } | { error: string };

export interface StatusOk {
  charge: string;
  start_count: string;
  status: string;
  remains: string;
  currency: string;
}
export type StatusResponse = StatusOk | { error: string };

/** `action=status&orders=1,2,3` — keyed by order id. */
export type MultiStatusResponse = Record<string, StatusOk | { error: string }>;

export type BalanceResponse = { balance: string; currency: string } | { error: string };

export type RefillResponse = { refill: string | number } | { error: string };

export type CancelResponse =
  | Array<{ order: number | string; cancel: number | { error: string } }>
  | { error: string };

export interface AddOrderInput {
  service: string | number;
  link: string;
  quantity: number;
  /** Drip feed (optional, only for services that support it). */
  runs?: number;
  interval?: number;
  /** Custom Comments services: newline-separated list of comments (one per line).
   *  When present, providers use the comment count as the quantity. */
  comments?: string;
}

export type ProviderErrorCategory =
  | "provider_low_balance"
  | "provider_auth_error"
  | "provider_invalid_service"
  | "provider_invalid_order"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_unknown_error";

interface ProviderErrorOptions {
  httpStatus?: number;
  providerCode?: string;
  category?: ProviderErrorCategory;
  retryable?: boolean;
  safeMessage?: string;
}

/** Thrown for network failures, non-2xx responses, or unparseable bodies. */
export class ProviderError extends Error {
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;
  readonly safeMessage: string;

  constructor(message: string, opts?: ProviderErrorOptions) {
    super(message);
    this.name = "ProviderError";
    this.httpStatus = opts?.httpStatus;
    this.providerCode = opts?.providerCode;
    this.category = opts?.category ?? "provider_unknown_error";
    this.retryable = opts?.retryable ?? false;
    this.safeMessage = opts?.safeMessage ?? message;
  }
}
