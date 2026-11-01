import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTokenAddress, validatedContractSet, extractTokenCandidates, compareTokenContracts, type TokenChain } from "./token-contracts";
import { parseOfficialMemory, currentOfficialMemoryItems, type OfficialMemoryResource, type OfficialMemorySource } from "./official-memory";
import { decideLinkEnforcement } from "./link-moderation";

const SOL_A = "So11111111111111111111111111111111111111112";
const SOL_B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ETH_A = `0x${"aB".repeat(20)}`;
const ETH_B = `0x${"22".repeat(20)}`;
function resource(chain: TokenChain = "solana", addresses = [SOL_A]): OfficialMemoryResource {
  return { kind: "TOKEN_CONTRACT", url: null, quote: `Our official ${chain} token contracts: ${addresses.join(" ")}`, status: "confirmed", tokenContracts: { chain, addresses } };
}
function source(id = "42", revision = 100, r = resource()): OfficialMemorySource {
  return { platform_message_id: id, revision, message_thread_id: 31, source_url: null, is_pinned: false, is_announcement: false, status: "ready", resources: [r] };
}
const compare = (text: string, sources = [source()]) => compareTokenContracts(extractTokenCandidates(text), currentOfficialMemoryItems(sources));

test("address equality is case-sensitive for Solana and canonical for EVM; reject wrong widths", () => {
  assert.equal(normalizeTokenAddress(SOL_A, "solana"), SOL_A);
  assert.equal(normalizeTokenAddress("z".repeat(44), "solana"), null);
  assert.equal(normalizeTokenAddress(ETH_A, "ethereum"), ETH_A.toLowerCase());
  assert.equal(normalizeTokenAddress(ETH_A + "a", "ethereum"), null);
  assert.notEqual(normalizeTokenAddress(SOL_B.toLowerCase(), "solana"), SOL_B);
});

test("typed memory requires observed addresses, explicit chain and token-purpose evidence", () => {
  const r = resource();
  assert.ok(parseOfficialMemory(JSON.stringify([r]), r.quote, []));
  assert.equal(parseOfficialMemory(JSON.stringify([{ ...r, tokenContracts: { chain: "solana", addresses: [SOL_B] } }]), r.quote, []), null);
  assert.equal(validatedContractSet(r.tokenContracts, `Our token: ${SOL_A}`), null);
  assert.equal(validatedContractSet(r.tokenContracts, `Solana wallet: ${SOL_A}`), null);
  assert.equal(validatedContractSet({ chain: "tron", addresses: [SOL_A] }, r.quote), null);
  assert.equal(validatedContractSet(resource("ethereum", [ETH_A]).tokenContracts, `Ethereum and Base token: ${ETH_A}`), null);
  const evm = resource("ethereum", [ETH_A]);
  const parsed = parseOfficialMemory(JSON.stringify([evm]), evm.quote, [])!;
  assert.ok(validatedContractSet(parsed[0].tokenContracts, evm.quote));
});

test("screenshot-shaped trade brag and bare addresses are compared without requiring a URL", () => {
  assert.equal(compare(`sold half of\n${SOL_B} at a\n10x, thanks for the alpha`).status, "mismatch");
  assert.equal(compare(SOL_A).status, "match");
  assert.equal(compare(SOL_B).status, "mismatch");
  assert.equal(compare(`solana contract ${SOL_A} and ${SOL_B}`).status, "mismatch");
});

test("wallets, transactions and pool links are not treated as token contracts", () => {
  for (const text of [`My wallet: ${SOL_B}`, `buy from this wallet ${SOL_B}`, `https://solscan.io/account/${SOL_B}`, `https://dexscreener.com/solana/${SOL_B}`, `https://etherscan.io/tx/0x${"a".repeat(64)}`, "gm everyone"]) {
    assert.equal(extractTokenCandidates(text).length, 0, text);
  }
});

test("known token URL routes and hidden link destinations carry chain identity", () => {
  for (const url of [`https://solscan.io/token/${SOL_B}`, `https://pump.fun/coin/${SOL_B}`]) assert.equal(compare(url).status, "mismatch");
  assert.equal(compareTokenContracts(extractTokenCandidates("token info", [`https://solscan.io/token/${SOL_B}`]), currentOfficialMemoryItems([source()])).status, "mismatch");
  assert.equal(compare(`https://basescan.org/token/${ETH_B}`, [source("42", 100, resource("base", [ETH_A]))]).status, "mismatch");
  assert.equal(extractTokenCandidates(`https://evil.test/token/${SOL_B}`).length, 0);
});

test("missing, untrusted, ambiguous and stale reference data cannot prove mismatch", () => {
  assert.equal(compare(SOL_B, []).status, "unknown");
  const untrusted = currentOfficialMemoryItems([source()]).map(r => ({ ...r, isAdminAuthor: false }));
  assert.equal(compareTokenContracts(extractTokenCandidates(SOL_B), untrusted).status, "unknown");
  assert.equal(compare(SOL_B, [source(), source("43", 100, resource("solana", [SOL_B]))]).status, "unknown");
  assert.equal(compare(SOL_B, [source(), { ...source("42", 200), resources: [], status: "failed" }]).status, "unknown");
  assert.equal(compare(SOL_B, [source(), { ...source("43", 200), resources: [], status: "pending" }]).status, "unknown");
  assert.equal(compare(SOL_B, [source(), { ...source("43", 200), resources: [], status: "failed" }]).status, "unknown");
  assert.equal(compare(SOL_B, [source(), { ...source("43", 200), resources: [], status: "ready" }]).status, "mismatch");
  assert.equal(compare(SOL_B, [source(), { ...source("42", 200), resources: [] }]).status, "unknown");
  assert.equal(compare(SOL_B, [source(), source("43", 200, { ...resource(), status: "retracted" })]).status, "unknown");
});

test("official address sets support replacements, multiple contracts and separate networks", () => {
  assert.equal(compare(SOL_B, [source("42", 100, resource("solana", [SOL_A, SOL_B]))]).status, "match");
  assert.equal(compare(SOL_A, [source(), source("43", 200, resource("solana", [SOL_B]))]).status, "mismatch");
  const multi = [source(), source("43", 200, resource("ethereum", [ETH_A])), source("44", 200, resource("base", [ETH_B]))];
  assert.equal(compare(SOL_A, multi).status, "match");
  assert.equal(compare(`Ethereum CA ${ETH_A.toLowerCase()}`, multi).status, "match");
  assert.equal(compare(`Base CA ${ETH_B}`, multi).status, "match");
  assert.equal(compare(`Ethereum CA ${ETH_B}`, multi).status, "mismatch");
  assert.equal(compare(`CA ${ETH_A}`, multi).status, "unknown");
  assert.equal(compare(`CA ${ETH_B}`, [source("42", 100, resource("ethereum", [ETH_A]))]).status, "unknown");
  assert.equal(compare(`Ethereum Base CA ${ETH_A}`, [source("42", 100, resource("ethereum", [ETH_A]))]).status, "unknown");
});

test("deterministic mismatch uses warning ladder despite Promotion or classifier uncertainty; role exemptions remain", () => {
  const input = { category: "SAFE_RELEVANT_LINK" as const, confidence: "low" as const, tokenContractMismatch: true,
    isAdminOrTrusted: false, senderRoleUnknown: false, floodRepeat: false, priorWarningCount: 0, priorScamStrikeCount: 0,
    priorNegativeStatementCount: 0, solicitationAllowed: true, adminSolicitedExemption: true };
  for (let priorWarningCount = 0; priorWarningCount <= 4; priorWarningCount++) {
    const decision = decideLinkEnforcement({ ...input, priorWarningCount });
    assert.equal(decision.kind, priorWarningCount === 4 ? "DELETE_KICK" : "DELETE_WARN");
    if (decision.kind === "DELETE_WARN") assert.equal(decision.muteMinutes, [undefined, 10, 30, 60][priorWarningCount]);
  }
  assert.equal(decideLinkEnforcement({ ...input, isAdminOrTrusted: true }).kind, "ALLOW");
  assert.equal(decideLinkEnforcement({ ...input, senderRoleUnknown: true }).kind, "ALLOW");
  assert.equal(decideLinkEnforcement({ ...input, tokenContractMismatch: false }).kind, "ALLOW");
});
