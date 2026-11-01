export const PROVIDER_BASE_URL_QUERY_ERROR =
  "Enter only the API base URL, without ? or query parameters. Example: https://tgref.xyz/api/v2";

export const PROVIDER_BASE_URL_HELPER_TEXT =
  "Use only the base API endpoint. Do not include ?action=, API keys, or other query parameters.";

export type ProviderApiUrlErrorCode =
  | "required"
  | "invalid_url"
  | "query_not_allowed"
  | "fragment_not_allowed"
  | "credentials_not_allowed"
  | "https_required";

export type ProviderApiUrlValidationResult =
  | { ok: true; value: string }
  | { ok: false; code: ProviderApiUrlErrorCode; error: string };

interface ProviderApiUrlValidationOptions {
  requireHttps?: boolean;
}

function err(code: ProviderApiUrlErrorCode, error: string): ProviderApiUrlValidationResult {
  return { ok: false, code, error };
}

/**
 * Validates a provider API BASE endpoint URL.
 * Rules: no query string, no fragment, no embedded credentials.
 */
export function validateProviderApiBaseUrl(
  rawInput: string,
  options?: ProviderApiUrlValidationOptions
): ProviderApiUrlValidationResult {
  const raw = rawInput.trim();
  const requireHttps = options?.requireHttps ?? false;

  if (!raw) return err("required", "API URL is required.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err("invalid_url", "Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err("invalid_url", "Invalid URL");
  }

  if (requireHttps && url.protocol !== "https:") {
    return err("https_required", "Enter a secure API base URL starting with https://");
  }

  if (url.username || url.password) {
    return err("credentials_not_allowed", "API URL must not include username or password.");
  }

  // Reject any query content, including a bare trailing '?' where URL.search is empty.
  if (raw.includes("?") || url.search) {
    return err("query_not_allowed", PROVIDER_BASE_URL_QUERY_ERROR);
  }

  if (raw.includes("#") || url.hash) {
    return err(
      "fragment_not_allowed",
      "Enter only the API base URL, without # fragments. Example: https://tgref.xyz/api/v2"
    );
  }

  // Preserve trailing-slash convention exactly as entered (after trimming).
  return { ok: true, value: raw };
}
