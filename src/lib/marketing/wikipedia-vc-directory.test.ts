import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWikipediaVcFirmCandidates, parseWikipediaVcFirmProfile, wikipediaArticleUrl, WIKIPEDIA_VC_LIST_PAGE,
} from "./wikipedia-vc-directory";

// Fixture mirrors the REAL wikitable row markup confirmed live against
// https://en.wikipedia.org/api/rest_v1/page/html/List_of_venture_capital_firms
// on 2026-09-01 (fetched and inspected directly, not guessed) -- each row's
// firm-name cell carries a `rel="mw:WikiLink"` anchor; the flag-icon anchor
// beside it does NOT carry that attribute, and the headquarters cell is a
// second, separate wikilink.
const LIST_PAGE_HTML = `
<table class="wikitable sortable" style="font-size: 85%" id="mwEQ">
<tbody><tr style="background:lightgrey;"><th>Rank</th><th>Firm</th><th>Headquarters</th><th>AUM</th></tr>
<tr><td>1</td><td><a href="./United_States" title="United States">flag</a> <a rel="mw:WikiLink" href="./Andreessen_Horowitz" title="Andreessen Horowitz">Andreessen Horowitz</a></td><td><a rel="mw:WikiLink" href="./Menlo_Park,_CA" title="Menlo Park, CA">Menlo Park, CA</a></td><td>$90.0B</td></tr>
<tr><td>2</td><td><a href="./United_States" title="United States">flag</a> <a rel="mw:WikiLink" href="./Insight_Partners" title="Insight Partners">Insight Partners</a></td><td><a rel="mw:WikiLink" href="./New_York_City,_NY" title="New York City, NY">New York City, NY</a></td><td>$90.0B</td></tr>
</tbody></table>
<table class="wikitable sortable" style="font-size: 85%" id="mwcQ">
<tbody><tr><th>Rank</th><th>Firm</th></tr>
<tr><td>1</td><td><a rel="mw:WikiLink" href="./Andreessen_Horowitz" title="Andreessen Horowitz">a16z (also featured here)</a></td></tr>
<tr><td>2</td><td><a rel="mw:WikiLink" href="./Sequoia_Capital" title="Sequoia Capital">Sequoia Capital</a></td></tr>
</tbody></table>
`;

// Fixture mirrors the REAL "Infobox company" markup confirmed live against
// the Andreessen Horowitz Wikipedia article on 2026-09-01 -- a genuine VC
// firm's infobox, with a real Industry field saying "Venture capital" and a
// real Website field wrapped in `class="official-website"`.
const VC_FIRM_ARTICLE_HTML = `<html><body>
<table class="infobox ib-company vcard"><caption class="infobox-title fn org">AH Capital Management, LLC</caption>
<tbody>
<tr><th scope="row" class="infobox-label">Type</th><td class="infobox-data category"><a rel="mw:WikiLink" href="./Privately_held_company" title="Privately held company">Private</a></td></tr>
<tr><th scope="row" class="infobox-label">Industry</th><td class="infobox-data category"><a rel="mw:WikiLink" href="./Venture_capital" title="Venture capital">Venture capital</a></td></tr>
<tr><th scope="row" class="infobox-label">Founded</th><td class="infobox-data">July 6, 2009</td></tr>
<tr><th scope="row" class="infobox-label">Headquarters</th><td class="infobox-data adr"><div class="ib-company-locality locality"> <a rel="mw:WikiLink" href="./Menlo_Park,_California" title="Menlo Park, California">Menlo Park, California</a></div>, <div class="ib-company-country country-name"> U.S.</div></td></tr>
<tr><th scope="row" class="infobox-label">Website</th><td class="infobox-data"><span class="official-website"><span class="url"><a rel="mw:ExtLink nofollow" href="https://a16z.com/" class="external text">a16z.com</a></span></span></td></tr>
</tbody></table>
</body></html>`;

// Fixture mirrors a real Wikipedia CITY infobox (e.g. San Francisco) --
// no "Industry" field at all, and a completely different infobox class.
const NON_COMPANY_ARTICLE_HTML = `<html><body>
<table class="infobox ib-settlement vcard"><caption class="infobox-title">San Francisco</caption>
<tbody><tr><th scope="row" class="infobox-label">Country</th><td class="infobox-data">United States</td></tr></tbody></table>
</body></html>`;

// Fixture mirrors a real non-VC company infobox (e.g. a government agency)
// that DOES have an Industry-shaped field but not venture capital.
const NON_VC_COMPANY_ARTICLE_HTML = `<html><body>
<table class="infobox ib-company vcard"><caption class="infobox-title fn org">Enterprise Ireland</caption>
<tbody><tr><th scope="row" class="infobox-label">Industry</th><td class="infobox-data category">Government agency</td></tr></tbody></table>
</body></html>`;

/* ---------------------------------------------------------- constants ---- */

test("wikipediaArticleUrl builds the real REST API URL shape", () => {
  assert.equal(wikipediaArticleUrl("Andreessen_Horowitz"), "https://en.wikipedia.org/api/rest_v1/page/html/Andreessen_Horowitz");
});

test("WIKIPEDIA_VC_LIST_PAGE is the real list-page article title", () => {
  assert.equal(WIKIPEDIA_VC_LIST_PAGE, "List_of_venture_capital_firms");
});

/* ---------------------------------------------------------- parseWikipediaVcFirmCandidates ---- */

test("parseWikipediaVcFirmCandidates extracts every unique firm slug across multiple tables", () => {
  const candidates = parseWikipediaVcFirmCandidates(LIST_PAGE_HTML);
  assert.deepEqual(candidates.map((c) => c.slug), ["Andreessen_Horowitz", "Insight_Partners", "Sequoia_Capital"]);
});

test("parseWikipediaVcFirmCandidates never picks up the flag-icon or headquarters wikilinks", () => {
  const candidates = parseWikipediaVcFirmCandidates(LIST_PAGE_HTML);
  assert.equal(candidates.some((c) => c.slug === "United_States"), false);
  assert.equal(candidates.some((c) => c.slug.includes("Menlo_Park")), false);
  assert.equal(candidates.some((c) => c.slug.includes("New_York_City")), false);
});

test("parseWikipediaVcFirmCandidates derives a readable display name from the slug", () => {
  const candidates = parseWikipediaVcFirmCandidates(LIST_PAGE_HTML);
  assert.equal(candidates[0]!.name, "Andreessen Horowitz");
});

test("parseWikipediaVcFirmCandidates dedupes a firm appearing in more than one ranking table", () => {
  const candidates = parseWikipediaVcFirmCandidates(LIST_PAGE_HTML);
  assert.equal(candidates.filter((c) => c.slug === "Andreessen_Horowitz").length, 1);
});

test("parseWikipediaVcFirmCandidates returns an empty array for a page with no wikitables", () => {
  assert.deepEqual(parseWikipediaVcFirmCandidates("<html><body>nothing here</body></html>"), []);
});

/* ---------------------------------------------------------- parseWikipediaVcFirmProfile ---- */

test("parseWikipediaVcFirmProfile extracts the real website/headquarters/founded for a genuine VC firm", () => {
  const entry = parseWikipediaVcFirmProfile(VC_FIRM_ARTICLE_HTML, { slug: "Andreessen_Horowitz", name: "Andreessen Horowitz" });
  assert.equal(entry?.name, "Andreessen Horowitz");
  assert.equal(entry?.website, "https://a16z.com/");
  assert.equal(entry?.headquarters, "Menlo Park, California , U.S.");
  assert.equal(entry?.founded, "July 6, 2009");
});

test("parseWikipediaVcFirmProfile carries the given slug through untouched", () => {
  const entry = parseWikipediaVcFirmProfile(VC_FIRM_ARTICLE_HTML, { slug: "Andreessen_Horowitz", name: "Andreessen Horowitz" });
  assert.equal(entry?.slug, "Andreessen_Horowitz");
});

test("parseWikipediaVcFirmProfile rejects a non-company Wikipedia page (a city), never fabricating VC data", () => {
  const entry = parseWikipediaVcFirmProfile(NON_COMPANY_ARTICLE_HTML, { slug: "San_Francisco", name: "San Francisco" });
  assert.equal(entry, null);
});

test("parseWikipediaVcFirmProfile rejects a real company that isn't a VC firm (Industry says something else)", () => {
  const entry = parseWikipediaVcFirmProfile(NON_VC_COMPANY_ARTICLE_HTML, { slug: "Enterprise_Ireland", name: "Enterprise Ireland" });
  assert.equal(entry, null);
});

test("parseWikipediaVcFirmProfile returns null when there's no infobox at all", () => {
  const entry = parseWikipediaVcFirmProfile("<html><body>no infobox here</body></html>", { slug: "x", name: "x" });
  assert.equal(entry, null);
});

test("parseWikipediaVcFirmProfile handles a genuine VC firm with no Website field honestly (null, never fabricated)", () => {
  const html = `<table class="infobox ib-company vcard"><tbody><tr><th scope="row" class="infobox-label">Industry</th><td class="infobox-data category">Venture capital</td></tr></tbody></table>`;
  const entry = parseWikipediaVcFirmProfile(html, { slug: "quiet-capital", name: "Quiet Capital" });
  assert.equal(entry?.website, null);
  assert.equal(entry?.headquarters, null);
});

test("parseWikipediaVcFirmProfile never treats a non-http url as a real website", () => {
  const html = `<table class="infobox ib-company vcard"><tbody><tr><th scope="row" class="infobox-label">Industry</th><td class="infobox-data category">Venture capital</td></tr><tr><th scope="row" class="infobox-label">Website</th><td class="infobox-data"><span class="official-website"><span class="url"><a href="/wiki/Some_Other_Page">not a real site</a></span></span></td></tr></tbody></table>`;
  const entry = parseWikipediaVcFirmProfile(html, { slug: "x", name: "x" });
  assert.equal(entry?.website, null);
});
