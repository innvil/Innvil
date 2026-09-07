export type LinkValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function countUrls(raw: string): number {
  return (raw.match(/https?:\/\//gi) ?? []).length;
}

/**
 * Strict order-link validation.
 * - requires exactly one absolute http(s) URL
 * - rejects concatenated links or pasted markdown blobs
 * - returns the normalized URL string when valid
 */
export function validateOrderLink(raw: string): LinkValidationResult {
  const link = raw.trim();
  if (!link) return { ok: false, error: "Enter the link for your order." };

  if (countUrls(link) !== 1) {
    return { ok: false, error: "Enter one valid link only." };
  }
  if (/\s/.test(link)) {
    return { ok: false, error: "Remove spaces and paste one complete link." };
  }
  if (!/^https?:\/\//i.test(link)) {
    return { ok: false, error: "Link must start with http:// or https://." };
  }

  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Link must be a valid http(s) URL." };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: "Enter a valid link." };
  }
}