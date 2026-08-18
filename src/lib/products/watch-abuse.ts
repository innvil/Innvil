import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

/**
 * Simple, layered Watch anti-abuse identity model (migration 0067).
 * Hierarchy, per explicit spec:
 *   1. Innvil account id — canonical internal identity
 *   2. VERIFIED Telegram numeric user id — primary cross-account anchor
 *   3. Telegram community id — resource scope, not a human identity
 *   4. Payment provider reference — supporting signal
 *   5. IP — secondary risk signal only, never primary/hard identity
 *
 * Deliberately NOT a fraud platform: no scoring engine, no device
 * fingerprinting, no automatic permanent bans. Typed, explicit abuse
 * reasons only.
 */

export type LinkTelegramIdentityResult = { ok: true } | { ok: false; error: string; alreadyLinkedToAnotherAccount: boolean };

/**
 * Links an Innvil account to a Telegram numeric user id that has ALREADY
 * been verified elsewhere (e.g. the existing Telegram bot/community
 * connection flow, which only ever reads `from.id` off a real Telegram
 * webhook update — never a client-supplied value). This function itself
 * does not re-verify Telegram identity; it only records an
 * already-established link. Callers must never pass a raw, unverified,
 * client-submitted Telegram id into this.
 *
 * ONE verified Telegram person may be linked to at most ONE Innvil account
 * (migration 0071's `unique(telegram_user_id)` on watch_telegram_links) —
 * this is the specific rule that stops the same Telegram person from
 * creating a second Innvil account to repeatedly obtain free/trial access.
 * The pre-check below (`telegramIdentityLinkedElsewhere`) exists purely for
 * a friendlier error message; the DB constraint is the ultimate,
 * race-safe enforcement (a concurrent duplicate insert still fails on the
 * constraint even if this pre-check raced past it, and that failure is
 * caught and reported the same way below) — never silently transfers an
 * already-linked identity to a new account.
 */
export async function linkTelegramIdentity(admin: SupabaseClient, accountId: string, telegramUserId: number, telegramUsername?: string | null): Promise<LinkTelegramIdentityResult> {
  const elsewhere = await telegramIdentityLinkedElsewhere(admin, accountId, telegramUserId);
  if (elsewhere.length > 0) {
    return { ok: false, error: "This Telegram account is already linked to another Innvil account.", alreadyLinkedToAnotherAccount: true };
  }

  const { error } = await admin
    .from("watch_telegram_links")
    .upsert(
      { account_id: accountId, telegram_user_id: telegramUserId, telegram_username: telegramUsername ?? null },
      { onConflict: "account_id,telegram_user_id" }
    );

  if (error) {
    // Unique-violation on the telegram_user_id-only constraint == a
    // concurrent link from another account won the race between the
    // pre-check above and this write. Never surface the raw DB error (which
    // could hint at another account's data) — same customer-facing message
    // either way.
    if (error.code === "23505") {
      return { ok: false, error: "This Telegram account is already linked to another Innvil account.", alreadyLinkedToAnotherAccount: true };
    }
    return { ok: false, error: "Could not link this Telegram account. Please try again.", alreadyLinkedToAnotherAccount: false };
  }
  return { ok: true };
}

/**
 * Cross-account abuse signal: does this VERIFIED Telegram identity already
 * have a link to a DIFFERENT Innvil account? A determined user creating a
 * second account (and even a second community) can't escape this check,
 * since it keys on the Telegram identity, not the account or community.
 * Returns the set of other account ids this Telegram identity has linked
 * to — an empty array means no cross-account pattern detected.
 */
export async function telegramIdentityLinkedElsewhere(admin: SupabaseClient, accountId: string, telegramUserId: number): Promise<string[]> {
  const { data } = await admin
    .from("watch_telegram_links")
    .select("account_id")
    .eq("telegram_user_id", telegramUserId)
    .neq("account_id", accountId);
  return (data ?? []).map((r: { account_id: string }) => r.account_id);
}

export interface AccountTelegramIdentity {
  telegramUserId: number;
  telegramUsername: string | null;
  verifiedAt: string;
}

/** The account's own linked Telegram identity, for customer-facing Profile
 *  presentation ONLY — reads the exact same canonical `watch_telegram_links`
 *  table the anti-abuse checks above use, never a second identity model.
 *  Returns null when nothing is linked. `telegram_username` (migration 0073)
 *  is nullable — a pre-existing link from migration 0071's historical
 *  backfill, or a Telegram person with no username, genuinely has none;
 *  callers must fall back to the numeric id for display, never invent one. */
export async function getAccountTelegramIdentity(admin: SupabaseClient, accountId: string): Promise<AccountTelegramIdentity | null> {
  const { data } = await admin
    .from("watch_telegram_links")
    .select("telegram_user_id, telegram_username, verified_at")
    .eq("account_id", accountId)
    .order("verified_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    telegramUserId: data.telegram_user_id as number,
    telegramUsername: (data.telegram_username as string | null) ?? null,
    verifiedAt: data.verified_at as string,
  };
}

/* ============================================================
   Native (Panel-independent) account -> Telegram verification. The durable
   identity link is still written via linkTelegramIdentity() above -- this
   section only manages the SHORT-LIVED verification attempt (token
   generation, expiry, single-use consumption) that proves the account owns
   a real Telegram person before that link is created.
   ============================================================ */

const VERIFICATION_TOKEN_TTL_MINUTES = 15;

function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface TelegramVerificationAttempt {
  token: string; // plaintext -- returned ONLY at creation, never stored
  expiresAt: string;
}

/** Starts a new account-native Telegram verification attempt: generates a
 *  short-lived, single-use, cryptographically random token (never derived
 *  from the account id itself, so it can't be guessed or reconstructed from
 *  a leaked account id), stores only its hash, and cancels any of this
 *  account's own still-pending attempts first (so starting a new attempt
 *  never leaves a stale/zombie pending token — the account can only ever
 *  have one live attempt at a time). The caller builds the actual `/start`
 *  deep link from the returned plaintext token. */
export async function createTelegramVerificationAttempt(admin: SupabaseClient, accountId: string): Promise<TelegramVerificationAttempt> {
  await admin.from("watch_telegram_verification_attempts").update({ status: "cancelled" }).eq("account_id", accountId).eq("status", "pending");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MINUTES * 60_000).toISOString();
  await admin.from("watch_telegram_verification_attempts").insert({
    account_id: accountId,
    token_hash: hashVerificationToken(token),
    status: "pending",
    expires_at: expiresAt,
  });
  return { token, expiresAt };
}

export interface PendingTelegramVerification {
  expiresAt: string;
}

/** Whether this account has a currently-live (pending, not yet expired)
 *  verification attempt — powers Profile's polling "waiting for
 *  verification" state without exposing the token itself. */
export async function getPendingTelegramVerification(admin: SupabaseClient, accountId: string): Promise<PendingTelegramVerification | null> {
  const { data } = await admin
    .from("watch_telegram_verification_attempts")
    .select("expires_at")
    .eq("account_id", accountId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data ? { expiresAt: data.expires_at as string } : null;
}

export async function cancelPendingTelegramVerification(admin: SupabaseClient, accountId: string): Promise<void> {
  await admin.from("watch_telegram_verification_attempts").update({ status: "cancelled" }).eq("account_id", accountId).eq("status", "pending");
}

export type ConsumeTelegramVerificationResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: "invalid_or_expired" }
  | { ok: false; reason: "already_linked_elsewhere" };

/** Consumes a verification token presented via the official bot's `/start
 *  <token>` — the ONLY place a Telegram numeric user id becomes trusted:
 *  `telegramUserId`/`telegramUsername` must come from Telegram's own
 *  webhook `from.id`/`from.username`, never a client-submitted value.
 *  Single-use via a conditional UPDATE keyed on `status = 'pending'`
 *  (mirrors the proven `telegram_setup_sessions` consumption pattern,
 *  migration 0064) — a concurrent/duplicate delivery of the same `/start`
 *  can only ever win this race once; every other attempt (including a
 *  reused or already-expired token) fails closed. On success, delegates to
 *  the SAME `linkTelegramIdentity()` every other identity-link path uses —
 *  the account-uniqueness/anti-abuse constraint is enforced there, not
 *  duplicated here. */
export async function consumeTelegramVerificationAttempt(
  admin: SupabaseClient,
  token: string,
  telegramUserId: number,
  telegramUsername: string | null
): Promise<ConsumeTelegramVerificationResult> {
  const tokenHash = hashVerificationToken(token);
  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("watch_telegram_verification_attempts")
    .update({ status: "consumed", consumed_at: now })
    .eq("token_hash", tokenHash)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("account_id")
    .maybeSingle();
  if (!claimed) return { ok: false, reason: "invalid_or_expired" };

  const accountId = claimed.account_id as string;
  const linkResult = await linkTelegramIdentity(admin, accountId, telegramUserId, telegramUsername);
  if (!linkResult.ok) return { ok: false, reason: "already_linked_elsewhere" };
  return { ok: true, accountId };
}

export type WatchAbuseType = "trial_consumed" | "promo_consumed" | "payment_failed" | "flagged_pattern";
export type WatchAbuseScope = "account" | "telegram_identity" | "community" | "payment";

export interface RecordAbuseSignalInput {
  accountId?: string | null;
  telegramUserId?: number | null;
  telegramCommunityId?: string | null;
  paymentRef?: string | null;
  ipHash?: string | null;
  abuseType: WatchAbuseType;
  scope: WatchAbuseScope;
  expiresAt?: string | null;
}

export async function recordAbuseSignal(admin: SupabaseClient, input: RecordAbuseSignalInput): Promise<void> {
  await admin.from("watch_abuse_signals").insert({
    account_id: input.accountId ?? null,
    telegram_user_id: input.telegramUserId ?? null,
    telegram_community_id: input.telegramCommunityId ?? null,
    payment_ref: input.paymentRef ?? null,
    ip_hash: input.ipHash ?? null,
    abuse_type: input.abuseType,
    scope: input.scope,
    expires_at: input.expiresAt ?? null,
  });
}

/**
 * One-time-offer eligibility (trial/promo): checked at BOTH the account
 * level AND the verified-Telegram-identity level, per explicit instruction
 * — eligibility requires neither to have already consumed the offer. A
 * fresh community/account alone can never bypass this, since the Telegram
 * identity check doesn't care which account or community the offer is
 * being attempted from.
 */
export async function eligibleForOneTimeOffer(
  admin: SupabaseClient,
  accountId: string,
  telegramUserId: number | null,
  abuseType: Extract<WatchAbuseType, "trial_consumed" | "promo_consumed">
): Promise<boolean> {
  const { data: accountConsumed } = await admin
    .from("watch_abuse_signals")
    .select("id")
    .eq("account_id", accountId)
    .eq("abuse_type", abuseType)
    .eq("scope", "account")
    .maybeSingle();
  if (accountConsumed) return false;

  if (telegramUserId != null) {
    const { data: telegramConsumed } = await admin
      .from("watch_abuse_signals")
      .select("id")
      .eq("telegram_user_id", telegramUserId)
      .eq("abuse_type", abuseType)
      .eq("scope", "telegram_identity")
      .maybeSingle();
    if (telegramConsumed) return false;
  }

  return true;
}

/** IP is a SECONDARY risk signal only (spec: "not primary hard identity" —
 *  never used alone to block a customer). Never store/compare raw IPs;
 *  hash before persisting so this table can never leak a customer's real
 *  address, and so it can only ever be used for coarse correlation, never
 *  as a precise identity. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}
