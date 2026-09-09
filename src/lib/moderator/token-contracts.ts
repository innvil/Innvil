import type { CommunityKnowledgeItem } from "./community-message-knowledge";

export const TOKEN_CHAINS = ["solana", "ethereum", "base", "bsc", "polygon", "arbitrum", "optimism", "avalanche"] as const;
export type TokenChain = typeof TOKEN_CHAINS[number];
export interface TokenContractSet { chain: TokenChain; addresses: string[] }
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ADDRESS_RE = /(?<![a-zA-Z0-9])(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})(?![a-zA-Z0-9])/g;
const CHAIN_SIGNALS: Record<TokenChain, RegExp> = {
  solana: /\bsolana\b/i, ethereum: /\b(?:ethereum|erc-?20)\b/i, base: /\bbase\b/i,
  bsc: /\b(?:bsc|bnb chain|binance smart chain|bep-?20)\b/i, polygon: /\bpolygon\b/i,
  arbitrum: /\barbitrum\b/i, optimism: /\boptimism\b/i, avalanche: /\b(?:avalanche|avax)\b/i,
};
export function tokenChainsInText(text: string): TokenChain[] {
  return TOKEN_CHAINS.filter(chain => CHAIN_SIGNALS[chain].test(text));
}
export function unsupportedMismatchWarning(text: string): boolean {
  return /\b(?:scam|scammer|fraud|rugpull|fake|phishing)\b/i.test(text)
    || [...text.matchAll(ADDRESS_RE)].some(m => normalizeTokenAddress(m[0], m[0].startsWith("0x") ? "ethereum" : "solana") !== null);
}
export function normalizeTokenAddress(address: string, chain: TokenChain): string | null {
  if (chain !== "solana") return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  let value = BigInt(0);
  for (const ch of address) value = value * BigInt(58) + BigInt(BASE58.indexOf(ch));
  const leadingZeros = address.match(/^1*/)?.[0].length ?? 0;
  let bytes = 0;
  for (; value > BigInt(0); value >>= BigInt(8)) bytes++;
  return leadingZeros + bytes === 32 ? address : null;
}

/** Model extraction is not permission to invent an address or its chain.
 * Quotes must explicitly label token/contract purpose and the network. */
export function validatedContractSet(value: unknown, quote: string): TokenContractSet | null {
  if (!value || typeof value !== "object") return null;
  const v = value as TokenContractSet;
  if (!TOKEN_CHAINS.includes(v.chain) || !Array.isArray(v.addresses) || !v.addresses.length || v.addresses.length > 16
    || tokenChainsInText(quote).length !== 1 || !tokenChainsInText(quote).includes(v.chain) || !/\b(?:token|contract|mint|ca)\b/i.test(quote)) return null;
  const observed = new Set((quote.match(ADDRESS_RE) ?? []).map(a => normalizeTokenAddress(a, v.chain)));
  const addresses: string[] = [];
  for (const address of v.addresses) {
    if (typeof address !== "string") return null;
    const canonical = normalizeTokenAddress(address, v.chain);
    if (!canonical || !observed.has(canonical)) return null;
    addresses.push(canonical);
  }
  return { chain: v.chain, addresses: [...new Set(addresses)].sort() };
}

type Candidate = { address: string; chain: TokenChain | null; ambiguousChain?: boolean };
const EXPLORERS: Record<string, TokenChain> = {
  "solscan.io": "solana", "etherscan.io": "ethereum", "basescan.org": "base", "bscscan.com": "bsc",
  "polygonscan.com": "polygon", "arbiscan.io": "arbitrum", "optimistic.etherscan.io": "optimism", "snowtrace.io": "avalanche",
};

/** Only token-shaped references, not transaction hashes, wallet routes or
 * pool IDs. A base58 public key alone cannot prove that an account is a mint. */
export function extractTokenCandidates(text: string, links: string[] = []): Candidate[] {
  const candidates: Candidate[] = [];
  for (const raw of [...(text.match(/https?:\/\/\S+/gi) ?? []), ...links]) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.username || url.password) continue;
      const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
      const chain = EXPLORERS[url.hostname];
      if (chain && parts[0] === "token" && parts[1] && normalizeTokenAddress(parts[1], chain)) candidates.push({ address: parts[1], chain });
      if (url.hostname === "pump.fun" && parts[0] === "coin" && parts[1] && normalizeTokenAddress(parts[1], "solana")) candidates.push({ address: parts[1], chain: "solana" });
    } catch { /* malformed or unsupported destination is not a violation */ }
  }
  // Remove full/scheme-less URLs before scanning prose, so a pool/transaction
  // route cannot accidentally re-enter as a bare token address.
  const prose = text.replace(/https?:\/\/\S+|\b[a-z0-9.-]+\.[a-z]{2,24}\/\S*/gi, " ");
  const lines = prose.split(/\n/);
  for (const [index, line] of lines.entries()) {
    const addresses = [...line.matchAll(ADDRESS_RE)];
    const context = `${lines[index - 1] ?? ""} ${line}`;
    const tokenContext = /\b(?:token|contract|mint|ca|bought|buy|buying|sold|sell|selling|holding|shill)\b/i.test(context)
      || addresses.some(m => line.trim() === m[0]);
    if (!tokenContext || /\b(?:wallet|transaction|txid|liquidity pool|pool address|pair address)\b/i.test(context)) continue;
    const chains = tokenChainsInText(context);
    for (const m of addresses) {
      const isHex = /^0x/i.test(m[0]);
      const chain = chains.length === 1 ? chains[0] : !chains.length && !isHex ? "solana" : null;
      if (chain && !normalizeTokenAddress(m[0], chain)) continue;
      if (!chain && !isHex) continue;
      candidates.push({ address: m[0], chain, ambiguousChain: chains.length > 1 });
    }
  }
  return candidates;
}

export interface ContractComparison {
  status: "none" | "unknown" | "match" | "mismatch";
  mismatches: Array<{ chain: TokenChain; address: string; sourceMessageId: string }>;
}
export function compareTokenContracts(candidates: Candidate[], resources: CommunityKnowledgeItem[]): ContractComparison {
  const refs = new Map<TokenChain, Array<{ addresses: string[]; sourceMessageId: string }>>();
  for (const r of resources) {
    if (!r.isAdminAuthor || r.kind !== "TOKEN_CONTRACT" || !r.tokenContracts) continue;
    const validated = validatedContractSet(r.tokenContracts, r.text);
    if (!validated) continue;
    refs.set(validated.chain, [...(refs.get(validated.chain) ?? []), { addresses: validated.addresses, sourceMessageId: r.platformMessageId }]);
  }
  let unknown = false;
  const mismatches: ContractComparison["mismatches"] = [];
  for (const c of candidates) {
    if (c.ambiguousChain) { unknown = true; continue; }
    // EVM syntax does not identify a network. Do not assume that a new
    // address belongs to whichever EVM chain happens to have known memory.
    const chain = c.chain;
    const current = chain ? refs.get(chain) : undefined;
    if (!chain || !current?.length || new Set(current.map(r => r.addresses.join(","))).size !== 1) { unknown = true; continue; }
    const address = normalizeTokenAddress(c.address, chain);
    if (!address) { unknown = true; continue; }
    if (!current[0].addresses.includes(address)) mismatches.push({ chain, address, sourceMessageId: current[0].sourceMessageId });
  }
  return { status: mismatches.length ? "mismatch" : unknown ? "unknown" : candidates.length ? "match" : "none", mismatches };
}
