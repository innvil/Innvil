import "server-only";

/**
 * Generic, token-PARAMETERIZED Telegram Bot API caller. Replaces the old
 * telegram.ts's telegramApi(), which read a single global TELEGRAM_BOT_TOKEN —
 * every caller here must pass the specific bot token to act as (the Innvil
 * Manager Bot's own token, or a resolved subscriber-owned managed-bot token).
 * There is no implicit "current" bot identity.
 */

export type TelegramResult<T> = { ok: true; result: T } | { ok: false; error: string; errorCode?: number };

/** Bounded well under the webhook route's 30s maxDuration -- previously this
 *  had NO timeout at all (plain fetch, no AbortController), so a stalled
 *  Telegram API call could hang for the caller's entire remaining budget
 *  with zero protection. Telegram's API is normally fast; this is defense
 *  in depth, not the primary suspect in the live incident (see client.ts's
 *  postJson doc comment for the actual root cause). */
const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

export async function telegramApiCall<T>(
  token: string,
  method: string,
  payload: Record<string, unknown> = {}
): Promise<TelegramResult<T>> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
  let response: Response;
  let bodyText: string;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString(),
      signal: controller.signal,
    });
    // Drained under the SAME abort scope as the fetch itself -- see the
    // matching fix/rationale in src/lib/ai/client.ts's postJson().
    bodyText = await response.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `Telegram ${method} request timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: err instanceof Error ? err.message : `Telegram ${method} request failed` };
  } finally {
    clearTimeout(timer);
  }
  const data = (() => {
    try {
      return JSON.parse(bodyText) as { ok?: boolean; result?: T; description?: string; error_code?: number };
    } catch {
      return null;
    }
  })();
  if (!response.ok || !data?.ok) {
    return { ok: false, error: data?.description || `Telegram ${method} failed`, errorCode: data?.error_code };
  }
  return { ok: true, result: data.result as T };
}

/** Telegram's own hard limit on files a bot can fetch via getFile (20 MB) --
 *  checked BEFORE attempting a download, not after, so an oversized upload
 *  never even starts downloading (media moderation's own, generally
 *  tighter, size limit is enforced separately by the caller). */
export const TELEGRAM_MAX_DOWNLOADABLE_BYTES = 20 * 1024 * 1024;
const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 15_000;

/** Resolves a Telegram file_id to its download path + size via getFile —
 *  required before any file can actually be fetched (Telegram's file_id
 *  alone isn't a URL). */
export async function getTelegramFile(token: string, fileId: string): Promise<TelegramResult<{ file_path: string; file_size?: number }>> {
  return telegramApiCall<{ file_path: string; file_size?: number }>(token, "getFile", { file_id: fileId });
}

/** Downloads a Telegram file's raw bytes given the file_path from
 *  getTelegramFile. Bounded by both a byte-size ceiling (checked via
 *  Content-Length when present, and again against the actual downloaded
 *  size as a fallback since some responses omit it) and a request timeout —
 *  untrusted user-uploaded media must never be downloaded unboundedly. */
export async function downloadTelegramFileBuffer(token: string, filePath: string, maxBytes: number = TELEGRAM_MAX_DOWNLOADABLE_BYTES): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `Telegram file download failed (${res.status})` };
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > maxBytes) return { ok: false, error: "file exceeds download size limit" };
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) return { ok: false, error: "file exceeds download size limit" };
    return { ok: true, buffer: Buffer.from(arrayBuffer) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { ok: false, error: "Telegram file download timed out" };
    return { ok: false, error: err instanceof Error ? err.message : "Telegram file download failed" };
  } finally {
    clearTimeout(timer);
  }
}

export function cleanTelegramHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}
