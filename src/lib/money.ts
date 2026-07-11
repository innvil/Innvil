import type { MarkupKind } from "@/src/types/db";

/** 4-dp rounding to match the DB numeric(12,4) columns. */
export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Selling rate (per 1000) from the provider cost and a markup rule:
 *  - percent:     cost * (1 + value/100)   e.g. value 20 → +20%
 *  - multiplier:  cost * value             e.g. value 1.5 → ×1.5
 *  - fixed:       cost + value             e.g. value 0.10 → +$0.10
 */
export function computeSellRate(
  providerRate: number,
  kind: MarkupKind,
  value: number
): number {
  const cost = Number.isFinite(providerRate) ? providerRate : 0;
  const v = Number.isFinite(value) ? value : 0;
  let rate: number;
  if (kind === "percent") rate = cost * (1 + v / 100);
  else if (kind === "multiplier") rate = cost * v;
  else rate = cost + v; // fixed
  return round4(Math.max(rate, 0));
}
