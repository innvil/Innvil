import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTlgrmDirectoryHtml, parseTlgrmLastPage, tlgrmCategoryUrl,
  isKnownTlgrmCategory, TLGRM_CATEGORIES,
  isWithinLeadMemberRange, TELEGRAM_LEAD_MIN_MEMBERS, TELEGRAM_LEAD_MAX_MEMBERS,
} from "./telegram-directory";

// Fixture mirrors the REAL markup shape confirmed live against
// tlgrm.eu/channels/crypto on 2026-08-26 (fetched and inspected directly,
// not guessed) -- a promo/sponsored card (no subscribers span) followed by
// two ordinary organic cards.
const FIXTURE_HTML = `
<section class="channel-cards">
<div class="channel-card">
    <header class="channel-card__top">
        <div class="channel-card__info">
            <h3 class="channel-card__title">
                <a href="https://tlgrm.eu/channels/@AIdreamfans" >
                    AI Dreamfans
                </a>
            </h3>
            <div class="channel-card__meta">
                <a class="channel-card__username" href="https://tlgrm.eu/channels/@AIdreamfans" >
                    &commat;AIdreamfans
                </a>
            </div>
        </div>
    </header>
    <div class="channel-card__description">
        Chat with AI girlfriends 18+
    </div>
    <a class="channel-card__promo-label" rel="nofollow" target="_blank" href="https://forms.tlgrm.eu/form/x">
        Promo    </a>
</div>
                                            <div class="channel-card">
    <header class="channel-card__top">
        <div class="channel-card__info">
            <h3 class="channel-card__title">
                <a href="https://tlgrm.eu/channels/@watcherguru" >
                    Watcher Guru
                </a>
                <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="false" aria-label="Verified channel" title="Verified channel"><use xlink:href="/icons.svg#verified"/></svg>
            </h3>
            <div class="channel-card__meta">
                <span class="channel-card__subscribers">627,781</span>
                <a class="channel-card__username" href="https://tlgrm.eu/channels/@watcherguru" >
                    &commat;watcherguru
                </a>
            </div>
        </div>
    </header>
    <div class="channel-card__description">
        Watcher Guru gives you unparalleled, unbiased coverage of crypto &amp; finance in real-time.
    </div>
</div>
                                            <div class="channel-card">
    <header class="channel-card__top">
        <div class="channel-card__info">
            <h3 class="channel-card__title">
                <a href="https://tlgrm.eu/channels/@iceblockchain" >
                    Ice Open Network
                </a>
            </h3>
            <div class="channel-card__meta">
                <span class="channel-card__subscribers">1,302,915</span>
                <a class="channel-card__username" href="https://tlgrm.eu/channels/@iceblockchain" >
                    &commat;iceblockchain
                </a>
            </div>
        </div>
    </header>
    <div class="channel-card__description">
        Web3 blockchain platform enabling scalable, privacy-focused decentralized applications
    </div>
</div>
<div id="vue-channels-list"
    data-current-page="1"
    data-last-page="2"
    data-path="https://tlgrm.eu/channels/crypto">
</div>
</section>
`;

test("REQUIRED: promo/sponsored cards (no organic ranking) are skipped entirely", () => {
  const entries = parseTlgrmDirectoryHtml(FIXTURE_HTML);
  assert.ok(!entries.some((e) => e.username === "AIdreamfans"), "the promo card must never be included in results");
});

test("REQUIRED: real organic entries are extracted with name/username/subscribers/description", () => {
  const entries = parseTlgrmDirectoryHtml(FIXTURE_HTML);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    name: "Watcher Guru",
    username: "watcherguru",
    subscriberCount: 627781,
    description: "Watcher Guru gives you unparalleled, unbiased coverage of crypto & finance in real-time.",
  });
  assert.deepEqual(entries[1], {
    name: "Ice Open Network",
    username: "iceblockchain",
    subscriberCount: 1302915,
    description: "Web3 blockchain platform enabling scalable, privacy-focused decentralized applications",
  });
});

test("REQUIRED: HTML entities are decoded in name/description (&amp; -> &, &commat; -> @)", () => {
  const entries = parseTlgrmDirectoryHtml(FIXTURE_HTML);
  const watcherGuru = entries.find((e) => e.username === "watcherguru")!;
  assert.ok(watcherGuru.description!.includes("crypto & finance"), "entity-decoded ampersand");
  assert.ok(!watcherGuru.description!.includes("&amp;"));
});

test("REQUIRED: the zero-padded numeric apostrophe entity (&#039;) decodes correctly -- found via a real live-page verification, not just the exact &#39; form", () => {
  const html = `<div class="channel-card"><h3 class="channel-card__title"><a>X</a></h3><div class="channel-card__meta"><a class="channel-card__username">&commat;xyz</a></div><div class="channel-card__description">a future that&#039;s censorship-resistant</div></div>`;
  const [entry] = parseTlgrmDirectoryHtml(html);
  assert.equal(entry.description, "a future that's censorship-resistant");
});

test("subscriber counts with thousands separators parse to real numbers, not NaN or the raw string", () => {
  const entries = parseTlgrmDirectoryHtml(FIXTURE_HTML);
  for (const e of entries) {
    assert.equal(typeof e.subscriberCount, "number");
    assert.ok(Number.isFinite(e.subscriberCount));
  }
});

test("an entry with no parseable username is skipped rather than producing a broken record", () => {
  const broken = `<div class="channel-card"><h3 class="channel-card__title"><a>No Username Here</a></h3></div>`;
  assert.deepEqual(parseTlgrmDirectoryHtml(broken), []);
});

test("empty/unrelated HTML produces an empty list, never throws", () => {
  assert.deepEqual(parseTlgrmDirectoryHtml("<html><body>nothing here</body></html>"), []);
  assert.deepEqual(parseTlgrmDirectoryHtml(""), []);
});

test("REQUIRED: parseTlgrmLastPage reads the real pagination widget's data-last-page attribute", () => {
  assert.equal(parseTlgrmLastPage(FIXTURE_HTML), 2);
});

test("parseTlgrmLastPage returns null when the pagination widget is absent -- never fabricates a page count", () => {
  assert.equal(parseTlgrmLastPage("<html><body>no pagination here</body></html>"), null);
});

test("parseTlgrmLastPage never returns 0 or a negative/non-finite value", () => {
  assert.equal(parseTlgrmLastPage('<div data-last-page="0"></div>'), null);
  assert.equal(parseTlgrmLastPage('<div data-last-page="abc"></div>'), null);
});

test("REQUIRED: tlgrmCategoryUrl builds page 1 with no query param, later pages with ?page=N", () => {
  assert.equal(tlgrmCategoryUrl("crypto", 1), "https://tlgrm.eu/channels/crypto");
  assert.equal(tlgrmCategoryUrl("crypto", 2), "https://tlgrm.eu/channels/crypto?page=2");
});

test("tlgrmCategoryUrl URL-encodes the category segment", () => {
  assert.equal(tlgrmCategoryUrl("a b", 1), "https://tlgrm.eu/channels/a%20b");
});

test("REQUIRED: 'adult' is never a known/allowlisted category, regardless of what the real site itself lists", () => {
  assert.equal(isKnownTlgrmCategory("adult"), false);
  assert.ok(!(TLGRM_CATEGORIES as readonly string[]).includes("adult"));
});

test("isKnownTlgrmCategory accepts every real category this feature actually offers", () => {
  for (const c of TLGRM_CATEGORIES) assert.equal(isKnownTlgrmCategory(c), true);
});

test("isKnownTlgrmCategory rejects an arbitrary unrecognized string", () => {
  assert.equal(isKnownTlgrmCategory("not-a-real-category"), false);
  assert.equal(isKnownTlgrmCategory(""), false);
});

test("isWithinLeadMemberRange: the boundary values themselves are inclusive", () => {
  assert.equal(isWithinLeadMemberRange(TELEGRAM_LEAD_MIN_MEMBERS), true);
  assert.equal(isWithinLeadMemberRange(TELEGRAM_LEAD_MAX_MEMBERS), true);
});

test("isWithinLeadMemberRange rejects just below the minimum and just above the maximum", () => {
  assert.equal(isWithinLeadMemberRange(TELEGRAM_LEAD_MIN_MEMBERS - 1), false);
  assert.equal(isWithinLeadMemberRange(TELEGRAM_LEAD_MAX_MEMBERS + 1), false);
});

test("isWithinLeadMemberRange rejects a value well outside the range in either direction", () => {
  assert.equal(isWithinLeadMemberRange(50), false);
  assert.equal(isWithinLeadMemberRange(1_000_000), false);
});

test("isWithinLeadMemberRange never treats an unknown (null) count as in-range", () => {
  assert.equal(isWithinLeadMemberRange(null), false);
});

test("isWithinLeadMemberRange accepts a real value comfortably inside the range", () => {
  assert.equal(isWithinLeadMemberRange(25_000), true);
});
