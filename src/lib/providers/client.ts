import "server-only";
import {
  ProviderCredentials,
  ProviderServiceDTO,
  AddOrderInput,
  AddOrderResponse,
  StatusResponse,
  MultiStatusResponse,
  BalanceResponse,
  RefillResponse,
  CancelResponse,
  ProviderErrorCategory,
  ProviderError,
} from "./types";

function normalizeProviderMessage(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const msg = input.trim();
  return msg ? msg.slice(0, 300) : null;
}

function extractProviderErrorMessage(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  return (
    normalizeProviderMessage(obj.error) ??
    normalizeProviderMessage(obj.message) ??
    normalizeProviderMessage(obj.msg) ??
    normalizeProviderMessage(obj.detail)
  );
}

function extractProviderErrorCode(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  const val = obj.code ?? obj.error_code ?? obj.err_code;
  if (val == null) return undefined;
  return String(val).slice(0, 80);
}

function isInsufficientProviderBalance(msg?: string | null): boolean {
  if (!msg) return false;
  return /insufficient|not enough (funds|balance|money)|no (funds|balance)|low balance|top ?up|add funds/i.test(msg);
}

function classifyProviderError(
  msg: string | null,
  httpStatus?: number
): { category: ProviderErrorCategory; retryable: boolean; safeMessage: string } {
  const m = (msg ?? "").toLowerCase();

  if (isInsufficientProviderBalance(msg)) {
    return {
      category: "provider_low_balance",
      retryable: true,
      safeMessage: "Provider balance is insufficient right now.",
    };
  }
  if (/invalid api|api key|unauthorized|authori[sz]ed|access denied|permission/i.test(m)) {
    return {
      category: "provider_auth_error",
      retryable: false,
      safeMessage: "Provider authentication failed.",
    };
  }
  if (/invalid service|service not found|wrong service|unknown service|service id/i.test(m)) {
    return {
      category: "provider_invalid_service",
      retryable: false,
      safeMessage: "Provider rejected the selected service.",
    };
  }
  if (/invalid|quantity|link|url|post|parameter|min|max|bad request|comments/i.test(m)) {
    return {
      category: "provider_invalid_order",
      retryable: false,
      safeMessage: "Provider rejected the order details.",
    };
  }
  if (httpStatus === 429 || /too many|rate limit|throttle|flood/i.test(m)) {
    return {
      category: "provider_rate_limited",
      retryable: true,
      safeMessage: "Provider is rate-limiting requests right now.",
    };
  }
  if ((httpStatus != null && httpStatus >= 500) || /timeout|temporar|unavailable|maintenance|gateway|network/i.test(m)) {
    return {
      category: "provider_unavailable",
      retryable: true,
      safeMessage: "Provider is temporarily unavailable.",
    };
  }
  return {
    category: "provider_unknown_error",
    retryable: false,
    safeMessage: httpStatus ? `Provider returned HTTP ${httpStatus}.` : "Provider returned an unexpected error.",
  };
}

/**
 * Generic SMM Panel API v2 client. Every call POSTs a form-encoded body of
 * `{ key, action, ...params }` to the provider's api_url and parses JSON.
 *
 * Server-only — receives the plaintext api key and must never run client-side.
 */
async function callProvider(
  creds: ProviderCredentials,
  params: Record<string, string | number>
): Promise<unknown> {
  const body = new URLSearchParams({ key: creds.apiKey });
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(creds.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
  } catch (e) {
    throw new ProviderError(
      `Could not reach provider: ${e instanceof Error ? e.message : "network error"}`,
      {
        category: "provider_unavailable",
        retryable: true,
        safeMessage: "Provider is temporarily unavailable.",
      }
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const providerMessage =
      extractProviderErrorMessage(parsed) ??
      normalizeProviderMessage(text) ??
      null;
    const info = classifyProviderError(providerMessage, res.status);
    throw new ProviderError(info.safeMessage, {
      httpStatus: res.status,
      providerCode: extractProviderErrorCode(parsed),
      category: info.category,
      retryable: info.retryable,
      safeMessage: info.safeMessage,
    });
  }

  if (parsed === null) {
    throw new ProviderError("Provider returned a non-JSON response", {
      category: "provider_unknown_error",
      retryable: false,
      safeMessage: "Provider returned an invalid response.",
    });
  }

  return parsed;
}

export async function fetchServices(
  creds: ProviderCredentials
): Promise<ProviderServiceDTO[]> {
  const data = await callProvider(creds, { action: "services" });
  if (!Array.isArray(data)) {
    const err = (data as { error?: string })?.error;
    throw new ProviderError(err || "Unexpected services response");
  }
  return data as ProviderServiceDTO[];
}

export function addOrder(
  creds: ProviderCredentials,
  input: AddOrderInput
): Promise<AddOrderResponse> {
  const params: Record<string, string | number> = {
    action: "add",
    service: input.service,
    link: input.link,
  };
  // Custom Comments: the provider derives quantity from the comment count, so send
  // `comments` instead of `quantity` (sending both confuses some providers).
  if (input.comments != null && input.comments.trim() !== "") {
    params.comments = input.comments;
  } else {
    params.quantity = input.quantity;
  }
  if (input.runs != null) params.runs = input.runs;
  if (input.interval != null) params.interval = input.interval;
  return callProvider(creds, params) as Promise<AddOrderResponse>;
}

export function getStatus(
  creds: ProviderCredentials,
  orderId: string | number
): Promise<StatusResponse> {
  return callProvider(creds, { action: "status", order: orderId }) as Promise<StatusResponse>;
}

export function getMultiStatus(
  creds: ProviderCredentials,
  orderIds: Array<string | number>
): Promise<MultiStatusResponse> {
  return callProvider(creds, {
    action: "status",
    orders: orderIds.join(","),
  }) as Promise<MultiStatusResponse>;
}

export function refillOrder(
  creds: ProviderCredentials,
  orderId: string | number
): Promise<RefillResponse> {
  return callProvider(creds, { action: "refill", order: orderId }) as Promise<RefillResponse>;
}

export function cancelOrders(
  creds: ProviderCredentials,
  orderIds: Array<string | number>
): Promise<CancelResponse> {
  return callProvider(creds, {
    action: "cancel",
    orders: orderIds.join(","),
  }) as Promise<CancelResponse>;
}

export function getBalance(creds: ProviderCredentials): Promise<BalanceResponse> {
  return callProvider(creds, { action: "balance" }) as Promise<BalanceResponse>;
}
