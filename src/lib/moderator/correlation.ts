/* =========================================================
   Pure provisioning-correlation logic — no I/O, no Supabase, no Telegram
   calls. Extracted from manager-webhook.ts specifically so the identity
   and correlation decisions (the actual bug surface) are unit-testable
   without a Supabase/Telegram mocking harness this repo doesn't have.

   Telegram's Managed Bots deep link carries no custom correlation
   parameter, and the SUGGESTED username is only onboarding intent — the
   user can change it in Telegram before confirming (spec §3). So a
   managed_bot webhook event can never be safely correlated by requiring
   suggested_username === actual username. The only sound approach without
   a stronger signal (e.g. a linked Telegram owner id, which Innvil's
   onboarding doesn't currently capture — spec §8) is:

     - exactly one candidate pending attempt system-wide -> unambiguous, use it
     - zero candidates -> nothing to correlate
     - multiple candidates -> username is at best a weak tie-break hint;
       if it disambiguates to exactly one, use that one; otherwise this is
       a genuine ambiguity and must NOT be guessed (tenant isolation over
       convenience, spec §8) — the caller records a safe operational
       failure instead of attaching to an arbitrary tenant.
   ========================================================= */

export interface ProvisioningAttemptCandidate {
  id: string;
  suggestedUsername: string;
}

export type CorrelationResult =
  | { ok: true; attempt: ProvisioningAttemptCandidate }
  | { ok: false; reason: "none" | "ambiguous" };

/**
 * `candidates` must already be filtered by the caller to status='pending'
 * and not-yet-expired (expires_at > now) — this function only decides
 * WHICH of those candidates (if any) the incoming event safely correlates to.
 */
export function resolveProvisioningAttempt(
  candidates: ProvisioningAttemptCandidate[],
  actualUsername: string
): CorrelationResult {
  if (candidates.length === 0) return { ok: false, reason: "none" };
  if (candidates.length === 1) return { ok: true, attempt: candidates[0] };

  const lowerActual = actualUsername.toLowerCase();
  const usernameMatches = candidates.filter((c) => c.suggestedUsername.toLowerCase() === lowerActual);
  if (usernameMatches.length === 1) return { ok: true, attempt: usernameMatches[0] };

  return { ok: false, reason: "ambiguous" };
}

/* --------------------------------------------------- identity verification ---- */

export interface TelegramMeResult {
  id: number;
  username?: string | null;
}

export type IdentityVerification =
  | { ok: true; username: string | null }
  | { ok: false; reason: string };

/**
 * Final credential/identity check (spec §6): getMe on the freshly-retrieved
 * managed-bot token must report the SAME numeric id the managed_bot update
 * claimed. getMe's username (not the webhook payload's, not the suggested
 * one) is the canonical value to persist — Telegram is always authoritative.
 */
export function verifyManagedBotIdentity(
  meResult: TelegramMeResult | null,
  expectedBotId: number
): IdentityVerification {
  if (!meResult) return { ok: false, reason: "getMe did not return a result" };
  if (meResult.id !== expectedBotId) {
    return { ok: false, reason: `getMe id ${meResult.id} does not match managed_bot id ${expectedBotId}` };
  }
  return { ok: true, username: meResult.username ?? null };
}
