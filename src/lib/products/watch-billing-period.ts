/**
 * Pure, client-safe (no `server-only`) billing-period arithmetic for direct
 * Watch subscriptions. Every self-serve plan is billed on a CALENDAR-MONTH
 * period ("Aug 19 -> Sep 19"), not a fixed "30 days" -- centralized here so
 * it's never scattered as a magic-number literal anywhere else.
 */

/** Adds one calendar month, clamped to the last valid day of the target
 *  month when the source day doesn't exist there -- e.g. Jan 31 + 1 month
 *  = Feb 28 (or Feb 29 in a leap year), matching Postgres's own
 *  `date + interval '1 month'` semantics (never a JS-native month overflow
 *  into the following month, e.g. never "Mar 2/3" for a Jan 31 start). */
export function addOneMonthClamped(date: Date): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const lastDayOfTargetMonth = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  return new Date(Date.UTC(y, m + 1, clampedDay, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

export interface BillingPeriod {
  start: string;
  end: string;
}

/**
 * The ONE canonical period-extension rule, used identically by every
 * successful-payment path (initial purchase, on-time renewal, late
 * renewal, and plan change -- see the dated changelog entry for why plan
 * changes deliberately reuse this same rule rather than a second timing
 * model).
 *
 * - No existing period (first-ever payment): a fresh period starts NOW.
 * - Existing period still valid (paying early/on-time): extend from the
 *   existing END, never from the payment time -- an early renewal never
 *   shortens what the customer already paid for.
 * - Existing period already expired (a late renewal): a fresh period
 *   starts NOW -- no retroactive backdating, no free grace days.
 */
export function computeRenewedPeriod(existingPeriodEnd: string | null, now: Date): BillingPeriod {
  const anchor = existingPeriodEnd && new Date(existingPeriodEnd).getTime() > now.getTime() ? new Date(existingPeriodEnd) : now;
  return { start: now.toISOString(), end: addOneMonthClamped(anchor).toISOString() };
}

/** True when a period end exists AND has passed. A NULL period end is
 *  treated as "never expires" -- the safe grandfather state for every paid
 *  entitlement created before real period tracking existed (migration
 *  0080) -- never silently expire an account this migration didn't touch. */
export function periodHasExpired(periodEnd: string | null, now = new Date()): boolean {
  return periodEnd != null && new Date(periodEnd).getTime() <= now.getTime();
}
