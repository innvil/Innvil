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
  ProviderError,
} from "./types";

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
      `Could not reach provider: ${e instanceof Error ? e.message : "network error"}`
    );
  }

  if (!res.ok) {
    throw new ProviderError(`Provider returned HTTP ${res.status}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("Provider returned a non-JSON response");
  }
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
    quantity: input.quantity,
  };
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
