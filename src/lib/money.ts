import type { MarkupKind } from "@/src/types/db";

/** 4-dp rounding to match the DB numeric(12,4) columns. */
export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/* ---------------------------------------------------------------------------
   Currency — each panel operates in one well-known currency (default USD).
   --------------------------------------------------------------------------- */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  label: string;
}

/** Well-known currencies owners can operate in. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "PHP", symbol: "₱", label: "Philippine Peso" },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
  { code: "PKR", symbol: "₨", label: "Pakistani Rupee" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit" },
];

const SYMBOLS: Record<string, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c.symbol])
);

export function currencySymbol(code?: string | null): string {
  return SYMBOLS[(code || "USD").toUpperCase()] ?? "";
}

/** Format an amount in a panel's currency (symbol + 2dp; falls back to code). */
export function formatMoney(amount: number, code?: string | null): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const cc = (code || "USD").toUpperCase();
  const sym = SYMBOLS[cc];
  return sym ? `${sym}${n.toFixed(2)}` : `${n.toFixed(2)} ${cc}`;
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
