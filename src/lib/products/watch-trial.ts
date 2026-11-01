import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TRIAL_DURATION_DAYS, TRIAL_CAPACITY, TRIAL_MAX_SAVED_MODERATORS } from "@/src/lib/moderator/plan";
import { getAccountTelegramIdentity } from "./watch-abuse";

/**
 * Direct (Panel-less) Innvil Watch Free Trial. A temporary, one-time
 * entitlement — distinct from any permanent free tier (there isn't one).
 *
 * Reuses the ALREADY-CANONICAL trial constants from moderator/plan.ts
 * (TRIAL_DURATION_DAYS=7, TRIAL_CAPACITY={maxCommunities:1,maxActiveSlots:1},
 * TRIAL_MAX_SAVED_MODERATORS=1) -- these were established for the
 * Panel-distributed Virtual Moderator product; this is the SAME product's
 * trial, just a second distribution channel (standalone/direct-Watch),
 * never a second invented set of numbers.
 *
 * Durable claim/eligibility record: `watch_trial_claims` (migration 0079).
 * A row is written exactly once per account (and, independently, at most
 * once per verified Telegram identity, via a DB unique constraint on each
 * column -- never an application-only "if eligible then insert" race) and
 * is NEVER deleted -- not on expiry, not on a later paid upgrade -- so the
 * trial can never be reclaimed by either path.
 */

export type WatchTrialStatus = "telegram_required" | "eligible" | "active" | "expired";

export interface WatchTrialState {
  status: WatchTrialStatus;
  startedAt: string | null;
  endsAt: string | null;
}

interface TrialClaimRow {
  startedAt: string;
  endsAt: string;
}

async function loadTrialClaim(admin: SupabaseClient, accountId: string): Promise<TrialClaimRow | null> {
  const { data } = await admin.from("watch_trial_claims").select("started_at, ends_at").eq("account_id", accountId).maybeSingle();
  if (!data) return null;
  return { startedAt: data.started_at as string, endsAt: data.ends_at as string };
}

function claimIsActive(claim: TrialClaimRow, now = Date.now()): boolean {
  return new Date(claim.endsAt).getTime() > now;
}

/** The account's current, server-authoritative trial state. Expiry is a
 *  plain timestamp comparison at read time (mirrors readTrialState's
 *  `active` derivation in moderator/plan.ts) -- no background job required
 *  to make access expire, and a stale "active" claim can never grant
 *  entitlements past its own `ends_at`. */
export async function getWatchTrialState(admin: SupabaseClient, accountId: string): Promise<WatchTrialState> {
  const claim = await loadTrialClaim(admin, accountId);
  if (claim) {
    return { status: claimIsActive(claim) ? "active" : "expired", startedAt: claim.startedAt, endsAt: claim.endsAt };
  }
  const identity = await getAccountTelegramIdentity(admin, accountId);
  if (!identity) return { status: "telegram_required", startedAt: null, endsAt: null };
  return { status: "eligible", startedAt: null, endsAt: null };
}

/** True only while a real, unexpired trial claim exists -- the single
 *  boolean every entitlement/capacity/runtime consumer should call, rather
 *  than re-deriving trial-activeness from `getWatchTrialState` themselves. */
export async function hasActiveWatchTrial(admin: SupabaseClient, accountId: string): Promise<boolean> {
  const claim = await loadTrialClaim(admin, accountId);
  return claim ? claimIsActive(claim) : false;
}

export type StartWatchTrialResult = { ok: true; state: WatchTrialState } | { ok: false; error: string };

/**
 * Starts the trial, atomically. Server-generated timestamps only (never a
 * browser-supplied start time). Idempotent: a second concurrent/duplicate
 * request (double-click, or a retried action) never creates a second claim
 * -- it either observes the row this request just inserted, or loses a
 * genuine race to the DB's own unique constraints and re-resolves the
 * now-current durable state instead of erroring.
 */
export async function startWatchTrial(admin: SupabaseClient, accountId: string): Promise<StartWatchTrialResult> {
  const existing = await loadTrialClaim(admin, accountId);
  if (existing) return { ok: true, state: { status: claimIsActive(existing) ? "active" : "expired", startedAt: existing.startedAt, endsAt: existing.endsAt } };

  const identity = await getAccountTelegramIdentity(admin, accountId);
  if (!identity) return { ok: false, error: "Verify your Telegram account before starting the trial." };

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await admin.from("watch_trial_claims").insert({
    account_id: accountId,
    telegram_user_id: identity.telegramUserId,
    started_at: startedAt.toISOString(),
    ends_at: endsAt.toISOString(),
  });

  if (error) {
    // 23505 = a unique-constraint violation -- either this account's own
    // claim (a concurrent duplicate request won the race), or this
    // Telegram identity's claim (already consumed through a different
    // account, e.g. before a future relink feature ever exists). Re-resolve
    // rather than assume which one -- never surface the raw DB error.
    if (error.code === "23505") {
      const state = await getWatchTrialState(admin, accountId);
      if (state.status === "active" || state.status === "expired") return { ok: true, state };
      return { ok: false, error: "This Telegram account has already used its free trial." };
    }
    return { ok: false, error: "Could not start the trial. Please try again." };
  }

  return { ok: true, state: { status: "active", startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString() } };
}

export { TRIAL_DURATION_DAYS, TRIAL_CAPACITY, TRIAL_MAX_SAVED_MODERATORS };
