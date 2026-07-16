# Innvil Expansion Plan — Store Builder & Service Marketplace

*Working document — approved decisions + open items. SMM panel maker (current product) remains as-is; this covers the two future expansions: a no-code, crypto-native store builder ("Shopify-like") and a crypto-native service marketplace ("Fiverr-like").*

---

## 1. Strategic Positioning

- **Store builder edge:** crypto-native, no bank account required, **no recurring rent** — targets merchants Shopify/Stripe exclude (unbanked, no business account, not ready to commit $29–$399/mo before a first sale).
- **Marketplace edge:** lower combined fees than Fiverr (Fiverr ≈ 20% seller + 5.5% buyer), plus faster crypto payout vs. Fiverr's 7–14 day hold — targets freelancers underserved by slow withdrawal/payout access.
- Both products share one core trust mechanism: **escrow**, funded by crypto payments converted to stablecoin to avoid volatility exposure between sale and payout.
- Transparency is a deliberate differentiator: publish the fee structure and its purpose (not the exact detection/threshold logic) on landing page, SEO content, FAQ, and ToS.

---

## 2. Store Builder — Approved Structure

### 2.1 No-rent model — how the risk is contained
- **Architecture, not pricing, absorbs the "idle store" cost:** static/serverless storefronts on CDN, shared multi-tenant storage (no per-store provisioned server/DB), auto-suspend/archive dormant stores after a defined inactivity window (e.g. 90 days of zero traffic/sales), instant reactivation on return.
- This keeps "zero rent, ever" true and sustainable rather than a subsidized promotion that has to be walked back later.

### 2.2 One-time store creation fee
- **$30–$50, one-time**, paid by **card**, auto-converted to crypto/stablecoin on the backend.
- Card payment doubles as a first identity signal (billing address, AVS/CVV) — free preliminary KYC signal before any dedicated verification provider is used.
- Hold converted funds 24–48h before finalizing, to leave room to catch same-day card fraud/chargeback attempts before conversion is irreversible.
- Chargeback risk exists here specifically because a card is involved even though everything downstream is crypto — mitigated by: clear signup/creation logs (IP, KYC data, timestamps) to fight disputes, and using a payment processor experienced with crypto on/off-ramp businesses.

### 2.3 Ongoing monetization (replaces "rent")
- **Transaction fee on completed sales only** — no sale, no fee, ever.
- **Recurring listing fee** (per active listing, renewing every few months) — this is the actual rent-substitute: usage-proportional (a 5-product store pays almost nothing; a 500-product store pays proportionally more), which is fairer than Shopify's flat subscription.
- **Optional paid add-ons** (premium themes, email/marketing tools, analytics, custom domain, priority support) — opt-in revenue layered on top, doesn't touch the "no rent" pledge.

### 2.4 Abuse/spam guardrails
- Light identity verification at signup (email + phone minimum; card payment provides additional signal).
- Resource caps on new/unverified stores, lifting as trust/sales history builds.
- Rate-limits on store creation per identity/IP/wallet.

---

## 3. Service Marketplace — Approved Structure

- **Fee split: 5% total per transaction — 3% seller side (commission on sale), 2% buyer side (markup on top of price).**
- Positioned publicly as roughly half of Fiverr's effective take rate.
- Seller side intentionally carries more of the fee than buyer side (3:2) — mirrors the general pattern of Fiverr/Etsy/Shopify, where the earning side absorbs more platform cost than the price-sensitive, comparison-shopping buyer side.
- Escrow (see Section 4) is the mechanism protecting both sides — not the fee structure itself.

---

## 4. Escrow (Shared System — Both Products)

- Buyer payment is held (platform-controlled ledger/wallet) against a specific order, not released to seller immediately.
- **Release triggers:** buyer confirms delivery/satisfaction, OR auto-release timer expires with no dispute raised, OR a dispute is filed and resolved via arbitration/support flow.
- Milestone escrow supported for marketplace (split large projects into partial releases) — a known Fiverr weak point.
- **Escrow is what protects against a seller "going MIA"** — buyer funds were never released, so no money is lost; only a support/refund-timeout process is triggered. (This replaced the earlier idea of funding an MIA-protection reserve from the signup fee — not needed, since escrow already solves it structurally.)
- **Regulatory note (flagged, not resolved):** holding buyer funds in escrow means the platform is, in substance, holding customer money — this is in direct tension with any "we never hold funds" claim, and is very likely to trigger money-transmitter / custodial licensing requirements depending on jurisdiction. Real options going forward:
  1. Non-custodial escrow via smart contract (funds held by code, not a platform-controlled wallet).
  2. Partner with a licensed money-transmitter/payment processor and operate under their license.
  3. Pursue platform's own money-transmitter license directly.
  - **This requires a real fintech/payments lawyer consultation before launch** — noted here as an open action item, not resolved by this document.

---

## 5. Fees — Final Approved Version

| Fee | Structure | Notes |
|---|---|---|
| Store creation | $30–$50 one-time, card → crypto | Doubles as KYC signal; 24–48h hold before finalizing |
| Seller commission (marketplace) | 3% per completed sale | Flat, no tiering |
| Buyer markup (marketplace) | 2% on top of price | Flat, no tiering |
| **Withdrawal fee (universal formula)** | **Lesser of 2% or (greater of $100 flat / 0.5% of amount)** | See worked examples below — no seller-tier classification required |
| Listing fee (store builder) | Recurring, per active listing, renews every few months | Functions as the "rent" replacement — usage-proportional |
| Small-seller excess-fee claim | If trailing revenue < $1k/month for 3 consecutive months, seller may claim back **1% of total withdrawal fees paid** during that window | Lightweight goodwill rebate, decoupled from the fee formula itself; recurring/ongoing, not one-time |

**Withdrawal fee formula behavior (worked examples):**
- Under ~$5,000 withdrawn → 2% applies (scales up toward $100)
- ~$5,000–$20,000 withdrawn → flat $100 applies
- Above ~$20,000 withdrawn → 0.5% applies (fee scales up again past the $100 floor)

**Buyer-side fee refund policy:**
- Fully refundable up to escrow release / buyer confirmation.
- Only ~1% refundable in a short grace window immediately after confirmation.
- Non-refundable after escrow has released funds to the seller, or after the grace window closes — refund-eligibility window is tied to escrow release timing, not an independent calendar date.

---

## 6. anvil / ANVIL — Two Separate Initiatives

| | anvil (lowercase) | ANVIL (all caps) |
|---|---|---|
| What it is | In-platform points/loyalty currency | Real crypto token |
| Mechanics | Users "mint" daily via engagement; redeemable only for in-platform discounts | Presumably tradeable/holdable outside the platform |
| Complexity | Low — built in-house, own database, no exchange/legal complexity | High — tokenomics design, legal/securities review (varies by jurisdiction), likely contract audit, listing/liquidity strategy |
| Timeline | Buildable alongside core launch | Treated as a v2/v3 project, after core marketplace has real volume/utility to give the token meaning |

---

## 7. Global Treasury (Promotions Fund)

- Funded from a defined, explicit slice of transaction fees (not an ad hoc pool) — needs a clear ledger line so promo spend can't silently outpace inflow.
- **Purpose: global promotions only** (0% shipping, cashbacks, anvil-coin minting/discounts, partial tax/fee waivers, seller-side 0% commission promos) — explicitly **not** seller-added vouchers/discounts, which are a separate, seller-funded mechanism.
- Public differentiator: unlike platforms that quietly pocket float from withheld funds or take 0% "service fees" from sellers as a hidden margin, treasury spend is transparent and returned to users as promotions.
- Dispute/arbitration operational cost (support staff time on edge cases, not fund payouts — those are covered by escrow) should be a **separate** reserve line from the promo treasury, so a heavy promo season doesn't compete with dispute-handling capacity.

---

## 8. Staffing & Support Cost Planning

- Current fee structure is being priced with future team growth in mind, not just solo-founder-plus-AI support.
- Recommended approach (not yet built into fee numbers): estimate cost-per-support-ticket, estimate ticket rate per transaction (dispute/refund/KYC issues), derive a rough "support cost per transaction," and earmark a small dedicated slice of revenue toward it — separate from promo treasury and margin — so hiring first support staff later is funded by an existing line, not a fee increase.

---

## 9. Fraud / Behavior Guardrails

- **Withdrawal fee-avoidance detection:** rather than pure AI inference on balance-vs-withdrawal ratios, sellers **self-declare withdrawal cadence** (e.g., "every 7 days," "every 2 weeks"). Deviation from declared cadence (not raw withdrawal size) is the actual flag signal.
  - First flagged deviation → 7-day hold before next withdrawal.
  - Recurring deviations → hold escalates, capped at 30 days maximum.
  - A full calendar month with no flagged deviation resets standing.
  - Sellers can update their declared cadence at any time if needs change.
- Reclassification/tiering logic elsewhere in the system (if reintroduced later) should always tie to **verified identity**, not per-account/per-store, to prevent volume-splitting across multiple accounts.

---

## 10. Explicitly Deferred / Simplified Out of V1

*(Considered during planning, replaced by simpler mechanisms — kept here for reference, not currently part of the approved plan.)*

- Revenue-tier-based withdrawal fee classification (small/mid/mid-big/big tiers with different formulas) — replaced by the single universal formula in Section 5.
- 90-day 0% transaction fee period tied to identity — replaced by the deposit/waiver-until-depleted concept, which was itself later replaced by the flat one-time fee + universal withdrawal formula.
- Treasury as MIA-seller dispute insurance — reassigned; escrow handles this structurally, treasury is promotions-only.

---

## 11. Open Action Items (Not Yet Decided / Needs Outside Expertise)

1. **Legal/regulatory consultation (fintech/payments lawyer)** — required before finalizing: escrow custodial structure, money-transmitter licensing exposure, KYC/KYB threshold requirements by jurisdiction, and whether "we don't hold funds" language can be used at all given escrow.
2. **KYC/KYB provider selection** (e.g. Sumsub, Persona, Onfido) and exact verification tiers/thresholds — pending legal input on required thresholds.
3. **Large-withdrawal liveness/KYC trigger threshold** — structure agreed (optional for small/mid/mid-big, mandatory above a large-withdrawal threshold), exact dollar threshold pending regulatory guidance.
4. **Listing fee exact amount and renewal cadence** — mechanism agreed (recurring, per active listing), figures not yet set.
5. **ANVIL token** — full separate legal/tokenomics workstream, timeline TBD, not a near-term build item.
6. **Escrow implementation choice** — platform-controlled ledger vs. smart contract vs. licensed processor partnership — depends on legal consultation outcome.
7. **Rollout sequencing** — SMM panel fixes first, then store builder vs. marketplace order not yet decided.

---

*End of consolidated plan. Add new sections below as further decisions are made.*
