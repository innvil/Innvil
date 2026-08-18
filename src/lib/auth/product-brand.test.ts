import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthBrand } from "./product-brand";

/**
 * `getAuthProductContext()` itself wraps `isWatchHost()` (next/headers,
 * request-scoped) -- consistent with this codebase's existing convention of
 * not unit-testing header-based host detection helpers (watch-host.ts's
 * isWatchHost has no dedicated test either; verified instead via a live
 * request, see the CLAUDE.md entry for this pass). These tests cover the
 * pure part: given a resolved host, which brand comes back, and that the
 * two brands never bleed into each other's design-token system.
 */

test("REQUIRED: watch host resolves to the Innvil Watch brand", () => {
  const brand = resolveAuthBrand(true);
  assert.equal(brand.id, "watch");
  assert.equal(brand.name, "Innvil Watch");
});

test("REQUIRED: non-watch host resolves to the plain Innvil brand", () => {
  const brand = resolveAuthBrand(false);
  assert.equal(brand.id, "innvil");
  assert.equal(brand.name, "Innvil");
});

function allClasses(brand: ReturnType<typeof resolveAuthBrand>): string {
  return [
    brand.rootClass, brand.panelClass, brand.displayClass, brand.monoClass,
    brand.textDimClass, brand.textFaintClass, brand.accentTextClass,
    brand.inputClass, brand.btnClass, brand.iconSoftBgClass, brand.iconAccentClass,
    brand.successSoftBgClass, brand.successAccentClass,
  ].join(" ");
}

// Curated token lists rather than a broad "w-" prefix regex -- Tailwind's own
// core utilities (w-full, w-10, ...) legitimately start with "w-" too and
// aren't part of the watch-root design-token system.
const WATCH_ONLY_TOKENS = ["watch-root", "w-card", "w-display", "w-mono", "w-text-dim", "w-text-faint", "w-teal", "w-btn-primary", "w-surface-raised", "w-line-soft", "w-green-soft-bg", "w-green"];
const INNVIL_ONLY_TOKENS = ["fp-root", "fp-panel", "fp-display", "fp-mono", "fp-text-dim", "fp-text-faint", "fp-gold", "fp-btn-primary", "fp-panel-raised", "fp-line-soft", "fp-safe-soft-bg", "fp-safe"];

test("REQUIRED: the Watch brand uses watch-root/w-* design tokens throughout, never fp-*", () => {
  const classes = allClasses(resolveAuthBrand(true));
  for (const token of WATCH_ONLY_TOKENS) assert.ok(classes.includes(token), `expected Watch brand to include "${token}"`);
  for (const token of INNVIL_ONLY_TOKENS) assert.ok(!classes.includes(token), `Watch brand leaked fp-* token "${token}"`);
});

test("REQUIRED: the Innvil brand uses fp-* design tokens throughout, never watch-root/w-*", () => {
  const classes = allClasses(resolveAuthBrand(false));
  for (const token of INNVIL_ONLY_TOKENS) assert.ok(classes.includes(token), `expected Innvil brand to include "${token}"`);
  for (const token of WATCH_ONLY_TOKENS) assert.ok(!classes.includes(token), `Innvil brand leaked watch-root/w-* token "${token}"`);
});

test("the Watch brand uses the real delivered Watch logo asset, not the default Innvil mark", () => {
  const brand = resolveAuthBrand(true);
  assert.equal(brand.logoSrc, "/watch/app-tile.svg");
});

test("the Innvil brand has no logoSrc -- renders the default Innvil mark instead", () => {
  const brand = resolveAuthBrand(false);
  assert.equal(brand.logoSrc, null);
});

test("REQUIRED: both brands point their header/logo link at \"/\" -- host-aware, never a hardcoded cross-product URL", () => {
  assert.equal(resolveAuthBrand(true).homeHref, "/");
  assert.equal(resolveAuthBrand(false).homeHref, "/");
});

test("resolveAuthBrand is a pure function of its input -- same input, same output, no shared mutable state", () => {
  const a = resolveAuthBrand(true);
  const b = resolveAuthBrand(true);
  assert.deepEqual(a, b);
});
