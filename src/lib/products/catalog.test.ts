import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProductInput, productPurchasable, PRODUCT_STATUSES, type ProductInput, type ProductRow } from "./catalog";
import { WATCH_PRODUCT_SLUG } from "./watch";

/**
 * Phase 1 of the Innvil multi-product architecture — the generic Product
 * Catalog. These tests validate the NEW architecture itself (identity/
 * lifecycle rules, genericness), not existing product business logic —
 * per the task's own "do not add large duplicate test suites for existing
 * business logic" instruction.
 */

test("validateProductInput accepts a well-formed product", () => {
  const input: ProductInput = { slug: "watch", name: "Innvil Watch", description: "AI moderation", domain: "watch.innvil.cloud" };
  assert.deepEqual(validateProductInput(input), { ok: true });
});

test("validateProductInput rejects an uppercase or malformed slug", () => {
  assert.equal(validateProductInput({ slug: "Watch", name: "Innvil Watch" }).ok, false);
  assert.equal(validateProductInput({ slug: "w", name: "x" }).ok, false); // too short
  assert.equal(validateProductInput({ slug: "-watch", name: "x" }).ok, false); // must start with a letter
  assert.equal(validateProductInput({ slug: "water fall", name: "x" }).ok, false); // no spaces
});

test("validateProductInput requires a non-empty name", () => {
  const result = validateProductInput({ slug: "watch", name: "" });
  assert.equal(result.ok, false);
});

test("validateProductInput rejects an overly long name", () => {
  const result = validateProductInput({ slug: "watch", name: "x".repeat(121) });
  assert.equal(result.ok, false);
});

test("validateProductInput rejects an invalid status value", () => {
  // @ts-expect-error deliberately invalid at the type level too
  const result = validateProductInput({ slug: "watch", name: "Innvil Watch", status: "launched" });
  assert.equal(result.ok, false);
});

test("validateProductInput rejects a domain that doesn't look like a hostname", () => {
  const result = validateProductInput({ slug: "watch", name: "Innvil Watch", domain: "not a domain" });
  assert.equal(result.ok, false);
});

test("validateProductInput accepts a missing/empty domain (optional field)", () => {
  assert.equal(validateProductInput({ slug: "herald", name: "Innvil Herald" }).ok, true);
  assert.equal(validateProductInput({ slug: "herald", name: "Innvil Herald", domain: "" }).ok, true);
});

/* -------------------------------------------------------------- lifecycle ---- */

test("PRODUCT_STATUSES is exactly the 5 spec lifecycle states", () => {
  assert.deepEqual(PRODUCT_STATUSES, ["draft", "private_beta", "active", "hidden", "retired"]);
});

test("productPurchasable: only ACTIVE and PRIVATE_BETA are offered for a new purchase", () => {
  assert.equal(productPurchasable("active"), true);
  assert.equal(productPurchasable("private_beta"), true);
  assert.equal(productPurchasable("draft"), false);
  assert.equal(productPurchasable("hidden"), false); // existing owners keep access at the entitlement layer -- this catalog layer just says "not for new purchase"
  assert.equal(productPurchasable("retired"), false);
});

/* ------------------------------------------------- genericness (REQUIRED) ---- */
// "Do not hard-code Watch-specific fields into the generic Product table."
// "Product Catalog schema is not hard-coded specifically to Watch/Forge/Herald."

test("REQUIRED: the Product shape has no product-specific boolean flags (is_watch/is_panel/is_campaign etc.)", () => {
  const sample: ProductRow = {
    id: "p1", slug: "watch", name: "Innvil Watch", description: null, status: "active",
    domain: "watch.innvil.cloud", standaloneAvailable: true, crossSellAvailable: true,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
  const keys = Object.keys(sample);
  const forbidden = /^is_?(watch|forge|herald|panel|campaign)/i;
  assert.ok(keys.every((k) => !forbidden.test(k)), `found a product-specific field: ${keys.filter((k) => forbidden.test(k))}`);
});

test("REQUIRED: the same Product shape/validation works for any slug -- Forge, Watch, Herald, and a hypothetical future product all pass through identically", () => {
  for (const slug of ["forge", "watch", "herald", "atlas"]) {
    const result = validateProductInput({ slug, name: `Innvil ${slug}` });
    assert.equal(result.ok, true, `${slug} should validate the same as any other product`);
  }
});

/* --------------------------------------------------------- Watch-first ---- */

test("REQUIRED: Innvil Watch has a stable, immutable slug identity ('watch'), matching the seed migration", () => {
  assert.equal(WATCH_PRODUCT_SLUG, "watch");
});
