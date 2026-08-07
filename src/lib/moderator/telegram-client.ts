import "server-only";

/**
 * Generic, token-PARAMETERIZED Telegram Bot API caller. Replaces the old
 * telegram.ts's telegramApi(), which read a single global TELEGRAM_BOT_TOKEN —
 * every caller here must pass the specific bot token to act as (the Innvil
 * Manager Bot's own token, or a resolved subscriber-owned managed-bot token).
 * There is no implicit "current" bot identity.
 */

export type TelegramResult<T> = { ok: true; result: T } | { ok: false; error: string; errorCode?: number };

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
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString(),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : `Telegram ${method} request failed` };
  }
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: T; description?: string; error_code?: number }
    | null;
  if (!response.ok || !data?.ok) {
    return { ok: false, error: data?.description || `Telegram ${method} failed`, errorCode: data?.error_code };
  }
  return { ok: true, result: data.result as T };
}

export function cleanTelegramHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}
