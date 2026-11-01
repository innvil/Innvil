import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyResourceKind, scoreCommunityItemRelevance, rankCommunityKnowledge, pickWhitepaperLink,
  pickPinnedReference, otherOfficialResources, buildCommunityKnowledgeGrounding, type CommunityKnowledgeItem,
} from "./community-message-knowledge";

function item(over: Partial<CommunityKnowledgeItem>): CommunityKnowledgeItem {
  return {
    id: "id", messageThreadId: null, platformMessageId: "1", isAdminAuthor: true, isPinned: false,
    isAnnouncementTopic: false, kind: "OTHER", url: null, text: "", createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

/* --------------------------------------------------------- classification ---- */

test("REQUIRED (§8): a link is classified WHITEPAPER from surrounding text even when the URL path has no 'whitepaper' keyword", () => {
  assert.equal(classifyResourceKind("Here is our whitepaper: https://docs.example.com/abc123", "https://docs.example.com/abc123"), "WHITEPAPER");
});

test("classifyResourceKind falls back to the URL path only when the surrounding text gives no signal", () => {
  assert.equal(classifyResourceKind("check this out", "https://example.com/whitepaper.pdf"), "WHITEPAPER");
  assert.equal(classifyResourceKind("check this out", "https://docs.example.com/roadmap"), "ROADMAP");
});

test("REQUIRED: documentation/roadmap/presale are classified from surrounding admin text", () => {
  assert.equal(classifyResourceKind("Full documentation: https://docs.example.com", "https://docs.example.com"), "DOCUMENTATION");
  assert.equal(classifyResourceKind("Here is our roadmap: https://example.com/roadmap", "https://example.com/roadmap"), "ROADMAP");
  assert.equal(classifyResourceKind("Current presale page: https://example.com/presale", "https://example.com/presale"), "PRESALE");
});

test("REQUIRED: never guesses a MORE SPECIFIC kind from a bare domain with no path -- resolves WEBSITE only, never WHITEPAPER/DOCUMENTATION", () => {
  assert.equal(classifyResourceKind("here's our site", "https://example.com"), "WEBSITE");
  assert.equal(classifyResourceKind("here's our site", "https://example.com/"), "WEBSITE");
});

test("a URL with no recognizable signal anywhere resolves OTHER, never a fabricated specific kind", () => {
  assert.equal(classifyResourceKind("random message", "https://example.com/random-page-xyz"), "OTHER");
});

/* --------------------------------------------------------------- ranking ---- */

test("scoreCommunityItemRelevance is keyword-overlap based, 0 for no overlap", () => {
  assert.equal(scoreCommunityItemRelevance("what stage is the project in", item({ text: "the project is currently in presale stage" })), 2);
  assert.equal(scoreCommunityItemRelevance("what stage is the project in", item({ text: "completely unrelated content here" })), 0);
});

test("REQUIRED (§5): a non-admin-authored message is NEVER treated as authoritative, even if highly relevant", () => {
  const userClaim = item({ isAdminAuthor: false, text: "the project is launching tomorrow for sure" });
  assert.deepEqual(rankCommunityKnowledge("when does it launch", [userClaim]), []);
});

test("REQUIRED (§10): a NEWER admin update outranks an OLDER pinned fact on the same subject", () => {
  const oldPinned = item({ isPinned: true, text: "presale starts next month", createdAt: "2026-01-01T00:00:00.000Z" });
  const newAnnouncement = item({ isAnnouncementTopic: true, text: "presale is now live", createdAt: "2026-09-01T00:00:00.000Z" });
  const ranked = rankCommunityKnowledge("is the presale live", [oldPinned, newAnnouncement], 4, new Date("2026-09-01T01:00:00.000Z"));
  assert.equal(ranked[0].text, "presale is now live");
});

test("REQUIRED: rankCommunityKnowledge returns an EMPTY array when nothing is relevant -- never dumps unrelated content", () => {
  const irrelevant = item({ text: "good morning everyone" });
  assert.deepEqual(rankCommunityKnowledge("what is the contract address", [irrelevant]), []);
});

test("pinned content ranks above an equally-relevant, equally-recent non-pinned message", () => {
  const pinned = item({ isPinned: true, text: "the roadmap covers Q1 through Q4", createdAt: "2026-06-01T00:00:00.000Z" });
  const plain = item({ text: "the roadmap covers Q1 through Q4", createdAt: "2026-06-01T00:00:00.000Z" });
  const ranked = rankCommunityKnowledge("tell me about the roadmap", [plain, pinned]);
  assert.equal(ranked[0].isPinned, true);
});

/* --------------------------------------------------------- whitepaper/other ---- */

test("REQUIRED (§3): pickWhitepaperLink returns the ONE confirmed whitepaper URL, never a guessed one", () => {
  const wp = item({ kind: "WHITEPAPER", url: "https://docs.example.com/project-paper" });
  const website = item({ kind: "WEBSITE", url: "https://example.com" });
  assert.equal(pickWhitepaperLink([website, wp]), "https://docs.example.com/project-paper");
});

test("REQUIRED (§7): no confirmed whitepaper exists -> null, never derived from the website URL", () => {
  const website = item({ kind: "WEBSITE", url: "https://example.com" });
  assert.equal(pickWhitepaperLink([website]), null);
});

test("pickWhitepaperLink prefers the MOST RECENTLY observed whitepaper when more than one has ever been posted", () => {
  const older = item({ kind: "WHITEPAPER", url: "https://old-docs.example.com/wp", createdAt: "2026-01-01T00:00:00.000Z" });
  const newer = item({ kind: "WHITEPAPER", url: "https://docs.example.com/wp", createdAt: "2026-08-01T00:00:00.000Z" });
  assert.equal(pickWhitepaperLink([older, newer]), "https://docs.example.com/wp");
});

test("otherOfficialResources excludes WHITEPAPER and OTHER, keeps only the newest per kind", () => {
  const olderRoadmap = item({ kind: "ROADMAP", url: "https://a.com/roadmap-old", createdAt: "2026-01-01T00:00:00.000Z" });
  const newerRoadmap = item({ kind: "ROADMAP", url: "https://a.com/roadmap", createdAt: "2026-08-01T00:00:00.000Z" });
  const wp = item({ kind: "WHITEPAPER", url: "https://a.com/wp" });
  const other = item({ kind: "OTHER", url: "https://a.com/random" });
  const result = otherOfficialResources([olderRoadmap, newerRoadmap, wp, other]);
  assert.deepEqual(result, [{ kind: "ROADMAP", url: "https://a.com/roadmap" }]);
});

test("pickPinnedReference chooses the MOST RELEVANT pinned item to the question, not just any pinned item", () => {
  const pinnedA = item({ isPinned: true, text: "roadmap details for Q1 through Q4" });
  const pinnedB = item({ isPinned: true, text: "tokenomics breakdown and supply" });
  const chosen = pickPinnedReference("what's the tokenomics", [pinnedA, pinnedB]);
  assert.equal(chosen?.text, "tokenomics breakdown and supply");
});

test("pickPinnedReference returns null when no pinned item is relevant -- never forces an irrelevant reference", () => {
  const pinnedA = item({ isPinned: true, text: "welcome to the community" });
  assert.equal(pickPinnedReference("what's the contract address", [pinnedA]), null);
});

/* --------------------------------------------------- buildCommunityKnowledgeGrounding ---- */

test("REQUIRED: returns null (never an empty shell) when nothing at all is relevant", () => {
  assert.equal(buildCommunityKnowledgeGrounding("what's the CA", [item({ text: "gm" })]), null);
});

test("REQUIRED (§13): the full worked example -- facts + pinned reference + whitepaper all resolve together", () => {
  const announcement = item({ isAnnouncementTopic: true, text: "the project is currently in the presale stage" });
  const pinned = item({ isPinned: true, text: "pinned: presale stage details and timeline" });
  const wp = item({ kind: "WHITEPAPER", url: "https://docs.example.com/paper", text: "here's our whitepaper" });
  const grounding = buildCommunityKnowledgeGrounding("what stage is the project in", [announcement, pinned, wp], new Date(), "https://t.me/proj/5");
  assert.ok(grounding);
  assert.ok(grounding!.facts.length >= 1);
  assert.equal(grounding!.pinnedReference?.link, "https://t.me/proj/5");
  assert.equal(grounding!.whitepaperLink, "https://docs.example.com/paper");
});

test("REQUIRED (§8, silent-absence contract): with no whitepaper observed at all, whitepaperLink is null -- never a placeholder/error string", () => {
  const announcement = item({ isAnnouncementTopic: true, text: "the project is currently in presale" });
  const grounding = buildCommunityKnowledgeGrounding("what stage is the project in", [announcement]);
  assert.ok(grounding);
  assert.equal(grounding!.whitepaperLink, null);
});
