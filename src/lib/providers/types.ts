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
}

/** Thrown for network failures, non-2xx responses, or unparseable bodies. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
