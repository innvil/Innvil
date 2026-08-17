import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

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

/**
 * Links an Innvil account to a Telegram numeric user id that has ALREADY
 * been verified elsewhere (e.g. the existing Telegram bot/community
 * connection flow, which only ever reads `from.id` off a real Telegram
 * webhook update — never a client-supplied value). This function itself
 * does not re-verify Telegram identity; it only records an
 * already-established link. Callers must never pass a raw, unverified,
 * client-submitted Telegram id into this.
 */
export async function linkTelegramIdentity(admin: SupabaseClient, accountId: string, telegramUserId: number): Promise<void> {
  await admin
    .from("watch_telegram_links")
    .upsert({ account_id: accountId, telegram_user_id: telegramUserId }, { onConflict: "account_id,telegram_user_id" });
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
