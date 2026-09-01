import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVcSheetFundSlugs, parseVcSheetFundProfile, isKnownVcSheetCategory, VC_SHEET_CATEGORIES,
  vcSheetCategoryUrl, vcSheetFundUrl,
} from "./vcsheet-directory";

// Fixture mirrors the REAL JSON-LD block confirmed live against
// https://www.vcsheet.com/fund/andreessen-horowitz on 2026-09-01 (fetched
// and inspected directly, not guessed) -- a real schema.org/ProfilePage
// with a nested Organization mainEntity carrying the fund's own real name/
// website/location/sameAs links, distinct from the page-title-shaped root
// `name` field.
const FUND_PAGE_HTML = `<!DOCTYPE html><html><head><title>a16z - VC Fund Breakdown</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ProfilePage",
  "name": "a16z - VC Fund Breakdown",
  "description": "Leads mega-rounds for frontier-tech visions.",
  "mainEntity": {
    "@type": "Organization",
    "name": "a16z",
    "description": "Leads mega-rounds for frontier-tech visions.",
    "url": "http://www.a16z.com",
    "address": { "@type": "PostalAddress", "addressLocality": "Menlo Park, California" },
    "sameAs": [
      "http://www.linkedin.com/company/andreessen-horowitz",
      "http://twitter.com/a16z",
      "https://www.crunchbase.com/organization/andreessen-horowitz"
    ]
  }
}
</script>
</head><body></body></html>`;

// Fixture mirrors the REAL card structure of a /sheet/<category> listing
// page -- many `<a href="/fund/<slug>">` links, some repeated (a fund can
// appear more than once on the same page via different sort widgets).
const SHEET_PAGE_HTML = `
<div class="fund-card"><a href="/fund/andreessen-horowitz">a16z</a></div>
<div class="fund-card"><a href="/fund/accel">Accel</a></div>
<div class="fund-card"><a href="/fund/andreessen-horowitz">a16z (also featured here)</a></div>
<div class="fund-card"><a href="/fund/sequoia-capital">Sequoia Capital</a></div>
`;

/* ---------------------------------------------------------- categories ---- */

test("isKnownVcSheetCategory accepts every real curated category", () => {
  for (const c of VC_SHEET_CATEGORIES) assert.equal(isKnownVcSheetCategory(c), true);
});

test("isKnownVcSheetCategory rejects an arbitrary unrecognized string", () => {
  assert.equal(isKnownVcSheetCategory("not-a-real-category"), false);
  assert.equal(isKnownVcSheetCategory(""), false);
});

test("vcSheetCategoryUrl/vcSheetFundUrl build the real vcsheet.com URL shapes", () => {
  assert.equal(vcSheetCategoryUrl("web3-funds"), "https://www.vcsheet.com/sheet/web3-funds");
  assert.equal(vcSheetFundUrl("andreessen-horowitz"), "https://www.vcsheet.com/fund/andreessen-horowitz");
});

/* ---------------------------------------------------------- parseVcSheetFundSlugs ---- */

test("parseVcSheetFundSlugs extracts every unique fund slug from a sheet page", () => {
  assert.deepEqual(parseVcSheetFundSlugs(SHEET_PAGE_HTML), ["andreessen-horowitz", "accel", "sequoia-capital"]);
});

test("parseVcSheetFundSlugs returns an empty array for a page with no fund links", () => {
  assert.deepEqual(parseVcSheetFundSlugs("<html><body>nothing here</body></html>"), []);
});

/* ---------------------------------------------------------- parseVcSheetFundProfile ---- */

test("parseVcSheetFundProfile extracts the real fund name from mainEntity, never the page-title-shaped root name", () => {
  const entry = parseVcSheetFundProfile(FUND_PAGE_HTML, "andreessen-horowitz");
  assert.equal(entry?.name, "a16z");
});

test("parseVcSheetFundProfile extracts the real website/description/location", () => {
  const entry = parseVcSheetFundProfile(FUND_PAGE_HTML, "andreessen-horowitz");
  assert.equal(entry?.website, "http://www.a16z.com");
  assert.equal(entry?.description, "Leads mega-rounds for frontier-tech visions.");
  assert.equal(entry?.location, "Menlo Park, California");
});

test("parseVcSheetFundProfile finds the real X/Twitter and LinkedIn links from sameAs, ignoring Crunchbase", () => {
  const entry = parseVcSheetFundProfile(FUND_PAGE_HTML, "andreessen-horowitz");
  assert.equal(entry?.twitter, "http://twitter.com/a16z");
  assert.equal(entry?.linkedin, "http://www.linkedin.com/company/andreessen-horowitz");
});

test("parseVcSheetFundProfile carries the given slug through untouched", () => {
  const entry = parseVcSheetFundProfile(FUND_PAGE_HTML, "andreessen-horowitz");
  assert.equal(entry?.slug, "andreessen-horowitz");
});

test("parseVcSheetFundProfile returns null when the JSON-LD block is missing", () => {
  assert.equal(parseVcSheetFundProfile("<html><body>no ld+json here</body></html>", "x"), null);
});

test("parseVcSheetFundProfile returns null when the JSON-LD block is malformed JSON", () => {
  const html = `<script type="application/ld+json">{ not valid json </script>`;
  assert.equal(parseVcSheetFundProfile(html, "x"), null);
});

test("parseVcSheetFundProfile returns null when the block has no usable name", () => {
  const html = `<script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Organization"}}</script>`;
  assert.equal(parseVcSheetFundProfile(html, "x"), null);
});

test("parseVcSheetFundProfile handles a fund with no X or LinkedIn presence honestly (null, never fabricated)", () => {
  const html = `<script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Organization","name":"Quiet Capital","url":"https://quiet.capital"}}</script>`;
  const entry = parseVcSheetFundProfile(html, "quiet-capital");
  assert.equal(entry?.name, "Quiet Capital");
  assert.equal(entry?.twitter, null);
  assert.equal(entry?.linkedin, null);
});

test("parseVcSheetFundProfile never treats a non-http url field as a real website", () => {
  const html = `<script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Organization","name":"Bad URL Capital","url":"/fund/bad-url-capital"}}</script>`;
  const entry = parseVcSheetFundProfile(html, "bad-url-capital");
  assert.equal(entry?.website, null);
});
