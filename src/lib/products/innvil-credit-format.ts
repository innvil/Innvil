/**
 * Pure, plain (no JSX, no "use client", no server-only) USD display
 * formatting for Innvil Credit -- kept separate from any .tsx component so
 * it can be unit-tested directly (this codebase has no React Testing
 * Library/jsdom infra; importing a .tsx client component that pulls in
 * next/link into a plain node:test file breaks under the react-server test
 * condition -- same extraction pattern already used by watch-datetime.ts/
 * watch-trial-format.ts).
 */
export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
