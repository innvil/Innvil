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

/** Adds one calendar YEAR, clamped the same way as addOneMonthClamped (the
 *  only real-world case this matters for is a Feb 29 anchor in a leap
 *  year -> Feb 28 the following year, since it isn't one). Handles the
 *  "Aug 19, 2026 -> Aug 19, 2027" annual worked example exactly, and every
 *  ordinary calendar/leap-year boundary safely. */
export function addOneYearClamped(date: Date): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const isFeb29 = m === 1 && d === 29;
  const targetIsLeap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  const clampedDay = isFeb29 && !targetIsLeap(y + 1) ? 28 : d;
  return new Date(Date.UTC(y + 1, m, clampedDay, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

export interface BillingPeriod {
  start: string;
  end: string;
}

export type WatchBillingInterval = "monthly" | "annual";

/**
 * The ONE canonical period-extension rule, used identically by every
 * successful-payment path (initial purchase, on-time renewal, late
 * renewal, plan change, AND a billing-interval switch mid-cycle -- see the
 * dated changelog entry for why all of these deliberately reuse this same
 * rule rather than a second timing model per case).
 *
 * - No existing period (first-ever payment): a fresh period starts NOW.
 * - Existing period still valid (paying early/on-time, OR switching
 *   interval while still-entitled): extend from the existing END, never
 *   from the payment time -- an early renewal (or an interval switch)
 *   never shortens what the customer already paid for. This is also what
 *   makes monthly<->annual switching safe with zero proration: paying
 *   monthly while an annual period is still active simply adds one month
 *   AFTER the already-paid annual end; paying annual while a monthly
 *   period is still active adds one year after the already-paid monthly
 *   end -- no paid time is ever lost or double-charged.
 * - Existing period already expired (a late renewal): a fresh period
 *   starts NOW -- no retroactive backdating, no free grace days.
 *
 * `interval` determines only the EXTENSION LENGTH added on top of the
 * resolved anchor -- the anchor-selection logic above is identical
 * regardless of interval.
 */
export function computeRenewedPeriod(existingPeriodEnd: string | null, now: Date, interval: WatchBillingInterval = "monthly"): BillingPeriod {
  const anchor = existingPeriodEnd && new Date(existingPeriodEnd).getTime() > now.getTime() ? new Date(existingPeriodEnd) : now;
  const end = interval === "annual" ? addOneYearClamped(anchor) : addOneMonthClamped(anchor);
  return { start: now.toISOString(), end: end.toISOString() };
}

/** True when a period end exists AND has passed. A NULL period end is
 *  treated as "never expires" -- the safe grandfather state for every paid
 *  entitlement created before real period tracking existed (migration
 *  0080) -- never silently expire an account this migration didn't touch. */
export function periodHasExpired(periodEnd: string | null, now = new Date()): boolean {
  return periodEnd != null && new Date(periodEnd).getTime() <= now.getTime();
}
