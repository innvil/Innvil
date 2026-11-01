"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getAccountTelegramIdentity, createTelegramVerificationAttempt, getPendingTelegramVerification,
  cancelPendingTelegramVerification, type AccountTelegramIdentity,
} from "@/src/lib/products/watch-abuse";
import { getBotManagerUsername } from "@/src/lib/moderator/bot-manager-runtime";

/**
 * Native (Panel-independent) account -> Telegram verification, driven
 * entirely from the authenticated Innvil account -- no Panel id, Panel
 * owner record, or Forge entitlement is ever read or required by anything
 * in this file. Thin auth wrappers over the canonical logic in
 * watch-abuse.ts, matching the established pattern used by every other
 * Watch action file in this codebase.
 */

// NOTE: never `export type` from a "use server" file -- Next requires every
// export of such a module to be an async function, and a type export
// (erased before this runtime check, but still an `export`) has broken this
// exact codebase's whole server-actions bundle before (see CLAUDE.md's
// 2026-08-18 v1.23.4 entry). Consumers infer this shape via
// `Awaited<ReturnType<typeof getWatchTelegramState>>` instead.
type WatchTelegramState =
  | { status: "not_connected" }
  | { status: "pending"; expiresAt: string }
  | { status: "connected"; identity: AccountTelegramIdentity };

export async function getWatchTelegramState(): Promise<WatchTelegramState> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { status: "not_connected" };

  const identity = await getAccountTelegramIdentity(admin, user.id);
  if (identity) return { status: "connected", identity };

  const pending = await getPendingTelegramVerification(admin, user.id);
  if (pending) return { status: "pending", expiresAt: pending.expiresAt };

  return { status: "not_connected" };
}

export async function startWatchTelegramVerification(): Promise<{ ok: true; deepLink: string; expiresAt: string } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  let botUsername: string;
  try {
    botUsername = await getBotManagerUsername();
  } catch {
    return { ok: false, error: "Telegram verification isn't available right now. Please try again shortly." };
  }

  const attempt = await createTelegramVerificationAttempt(admin, user.id);
  return { ok: true, deepLink: `https://t.me/${botUsername}?start=${attempt.token}`, expiresAt: attempt.expiresAt };
}

export async function cancelWatchTelegramVerification(): Promise<void> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return;
  await cancelPendingTelegramVerification(admin, user.id);
}
