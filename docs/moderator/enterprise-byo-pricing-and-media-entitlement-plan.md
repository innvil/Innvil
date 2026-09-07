# Enterprise BYO pricing + Media Moderation entitlement — planning doc

> **STATUS: FUTURE PLANNING / DOCUMENTATION ONLY. NOT IMPLEMENTED.**
> No production billing logic, subscription enforcement, schema, migration, Vercel
> environment variable, live media-moderation limit, or Enterprise functionality was
> changed to produce this document. The canonical LIVE pricing constants still live in
> `src/lib/money.ts` (`MODERATOR_BASIC_PRICE` / `MODERATOR_STANDARD_PRICE` /
> `MODERATOR_PREMIUM_PRICE` / `MODERATOR_PRO_PRICE` = 49.99 / 114.99 / 209.99 / 359.99)
> and were **not** touched by this document. This file records the *intended future*
> pricing/entitlement direction so it can be implemented deliberately later, not as an
> instruction to change anything today.
>
> **The active engineering priority remains Telegram Virtual Moderator refinement/
> debugging** (Sightengine integration, photo moderation review, false-positive
> handling, production/Vercel verification, ffmpeg/video verification, moderator
> behavior correctness, Coordinator/idempotency, knowledge retrieval, AI routing,
> ongoing bug fixing). Enterprise/BYO work does not start until that's stable and the
> user separately requests implementation.

---

## 1. Normal Virtual Moderator subscription pricing (intended, supersedes the current live values)

| Tier | Price/mo | Moderator slots |
|---|---|---|
| Basic | **$49.99** | 2 |
| Standard | **$129.99** *(was $114.99)* | 5 |
| Premium | **$219.99** *(was $209.99)* | 10 |
| Pro | **$379.99** *(was $359.99)* | 20 |

Progression is intentional: **$49.99 → $129.99 → $219.99 → $379.99 → (future Enterprise
$599 → $799)**.

Basic is unchanged. Standard/Premium/Pro are the only three normal-tier values
changing from the current live constants in `money.ts`. **Applying this to
`money.ts`/billing enforcement is a separate, explicit implementation task — not done
by this document.**

### Community entitlements (unchanged, preserved as-is — do not conflate with pricing)
Moderator slots and community entitlements remain **separate concepts**. Per the
existing `MODERATOR_COMMUNITY_CAPACITY` table in `money.ts` / `CAPACITY` in
`moderator/plan.ts` (no product decision here changes this):

| Tier | Included communities | Expansion |
|---|---|---|
| Basic | 1 | hard-capped |
| Standard | 2 | hard-capped |
| Premium | 3 | expandable to 5 |
| Pro | 5 | expandable to 10 |

---

## 2. Future Enterprise BYO pricing (NOT implemented)

| Tier | Price/mo | Moderator deployments |
|---|---|---|
| Enterprise BYO 50 | **$599** | up to 50 licensed |
| Enterprise BYO Unlimited | **$799** | unlimited licensed |

"BYO" = the Enterprise customer supplies and pays for their **own** supported
conversational x-API credentials (Anthropic, DeepSeek, OpenAI, or a future supported
provider). Innvil still provides and operates the platform itself.

### Critical invariant — no silent fallback
**ENTERPRISE BYO MUST HAVE ZERO FALLBACK TO INNVIL-OWNED CONVERSATIONAL API
CREDENTIALS.** If the customer's own provider runs out of credits, hits quota, rejects
the key, rate-limits, suspends billing, or becomes unavailable, the
provider-dependent feature must fail/degrade appropriately — **never** silently switch
to an Innvil-owned conversational credential. This mirrors the existing hard
`INNVIL_REQUIRED_MODEL`/`getInnvilModelConfig()` invariant's philosophy (fail
explicitly rather than silently substitute), extended to a customer-owned-credential
context instead of a model-choice context.

`subscription_tier` (`ENTERPRISE`) and `api_source_mode` (`BYO` | `INNVIL_MANAGED`)
are **separate concepts**, never collapsed into one overloaded plan enum.

### Innvil Managed x-API Enterprise (kept conceptually distinct, not priced yet)
"Innvil Managed" means Innvil absorbs conversational-AI provider cost itself — the
opposite of BYO. It must **not** be forced into the same fixed BYO pricing above.
Future Innvil Managed Enterprise pricing should stay **slot/capacity-based, per-slot
where appropriate, or custom/negotiated** — not finalized here. Its media-moderation
allowance may eventually be contract-specific; also not finalized here.

### Proposed initial resource allowances (launch defaults, subject to revision from real usage data)

| Tier | Persistent storage | Monthly bandwidth |
|---|---|---|
| Enterprise BYO 50 | 25 GB | 500 GB |
| Enterprise BYO Unlimited | 100 GB | 2 TB |

Persistent storage is a **hard cap**, not overage-billed initially. At the cap:
- Do **not** delete existing data.
- Do **not** disable the entire tenant.
- Existing services continue where they don't require *additional* persistent
  storage.
- Only operations requiring *new* persistent storage are blocked.

Temporary media-processing workspace (the existing `mkdtemp`-based video-frame
extraction scratch space) is **separate** from persistent storage and unaffected by
this cap.

### "Unlimited" definition (important — avoid over-promising)
"Unlimited" means **unlimited licensed moderator deployments only**. It does **not**
mean unlimited CPU, RAM, bandwidth, persistent storage, temporary storage, concurrent
processing, queue capacity, media-classifier operations, video processing, database
load, or arbitrary compute. Preferred customer-facing qualification:

> "Unlimited moderator deployments. Platform fair-use and infrastructure safeguards
> apply."

Licensing and infrastructure capacity remain separate concepts — infrastructure
safeguards must never become a hidden, undisclosed moderator-slot limit.

---

## 3. Media Moderation entitlement (NOT implemented — planning only)

Applies from Basic through future Enterprise. **Moderator slots and media-safety
consumption remain separate concepts** — a customer's media-moderation allowance is
its own axis, not derived from or bundled into slot count.

### Media Moderation Unit (provider-independent accounting concept)
- 1 classified photo = **1 Media Moderation Unit**.
- 1 representative video frame actually SENT to the classifier = **1 Media
  Moderation Unit**.
- A Telegram photo → 1 classifier request → 1 unit.
- A Telegram video sampled at up to `MAX_VIDEO_SAMPLE_FRAMES` (currently 5, see
  `media-moderation.ts`) representative frames → up to that many classifier requests
  → up to that many units.

**The entitlement must NEVER determine how many frames Innvil samples.** The existing
bounded representative-frame architecture (`computeSamplePositions`,
`classifySampledFrames`, early exit on high-confidence explicit) remains solely
responsible for frame count — it is a safety AND cost invariant, not something a
larger allowance should relax. Never analyze every frame of a video regardless of
entitlement headroom.

**Deliberately Sightengine-independent naming.** Sightengine is currently Innvil's
first wired media-safety provider (`sightengine-provider.ts`), but "Media Moderation
Units" is an Innvil-owned abstraction — never "Sightengine Credits" or any
vendor-specific term in customer-facing product surfaces. Must remain usable
unchanged if Innvil later changes Sightengine's plan, switches providers, uses
multiple providers, or builds an internal classifier. Do not hard-code Sightengine's
own commercial pricing into subscription architecture.

### Proposed launch allowances

| Tier | Price/mo | Moderator slots | Media Moderation Units/mo |
|---|---|---|---|
| Basic | $49.99 | 2 | **500** |
| Standard | $129.99 | 5 | **2,000** |
| Premium | $219.99 | 10 | **5,000** |
| Pro | $379.99 | 20 | **10,000** |
| Enterprise BYO 50 | $599 | up to 50 | **20,000** |
| Enterprise BYO Unlimited | $799 | unlimited | **30,000** |

Progression is intentional: **500 → 2,000 → 5,000 → 10,000 → 20,000 → 30,000**. Lower
tiers should provide meaningful, real media moderation while limiting Innvil's
external-classifier and infrastructure cost exposure — the cheapest subscription
should never become a cheap route to high-volume external media classification.
Allowances may be increased later once Innvil has real production usage data; it's
preferable to launch conservative and raise later than promise a large allowance and
have to cut it.

### Customer-facing wording
Internally: **Media Moderation Units**. Customer-facing plan cards may use simpler
language, e.g. **"Included media moderation capacity"** or **"Included media-safety
checks."** Never advertise a raw file/video count ("500 videos", "30,000 media
files") — one video can consume multiple bounded representative-frame
classifications. If UI uses "checks", supporting docs should explain: photos
generally consume one check; video moderation analyzes a bounded number of
representative frames; one video can therefore consume multiple checks. Keep the
pricing-card explanation simple.

### Hard cap, not overage billing (initial behavior)
Media Moderation Units are hard monthly subscription caps at launch — no automatic
media-classifier overage billing yet. Conceptual future behavior once implemented:

| Usage | Behavior |
|---|---|
| 0–70% | normal |
| ~70–80% | informational warning |
| ~90% | stronger warning |
| 100% | stop sending NEW media to the external safety provider until reset, or a future add-on/upgrade |

At 100%, do **NOT**: disable the entire moderator; delete incoming media merely
because the allowance is exhausted; interpret allowance exhaustion as explicit
content; disable normal Telegram processing; disable normal text/link moderation;
disable Project Profile/knowledge; disable Auto-Posting (a separate entitlement); or
fabricate an explicit-media result. Represent the condition as its own distinct
outcome — conceptually `MEDIA_LIMIT_REACHED` — parallel to the existing
`MediaFailureKind` failure taxonomy in `media-moderation.ts`, and it must resolve to
no destructive enforcement by itself, same as every other failure kind already does
via `decideMediaEnforcement`.

### What must keep working after media-limit exhaustion
Where technically independent of the media classifier specifically: Virtual
Moderator text behavior, deterministic moderation, spam/link detection, Telegram
processing generally, Project Profile/knowledge, Auto-Posting (its own entitlement),
`SILENCE`/`REACT`/deterministic `SHORT_ACK`, and every other non-media-classifier
capability.

### Deduplication (reuses the existing single-enforcer architecture — no change needed)
One Telegram media event must not consume duplicate Media Moderation Units merely
because multiple Innvil moderator deployments exist in the same community. **The
existing architecture already satisfies this** (see `runMediaModeration` in
`community-runtime.ts`): `deployments[0]` is the single enforcer; only that one
deployment's classification call chain ever runs per message; `isDuplicateUpdate`
(webhook-retry dedup) and `moderator_media_dedup` (file-level dedup) both prevent
re-classification. When metering is eventually implemented, unit consumption should
be counted at the SAME single point classification actually happens — never once per
deployed moderator, and never for a message that dedup already resolved without
reaching the classifier.

### Provider failure accounting (deferred to implementation time)
When entitlement enforcement is eventually implemented, distinguish successful
classification / attempted classification / provider failure / internal retry. Do
not design the entitlement so a customer loses substantial monthly capacity because
Innvil or the external provider had an outage; do not blindly charge multiple units
for internal retries of the same logical classification operation. The precise
accounting boundary should be chosen during implementation, after inspecting the
real provider's actual retry/billing behavior — no complex reconciliation design is
needed at this planning stage.

### Preserved result-invariant taxonomy
`SAFE` / `EXPLICIT` / `UNCERTAIN` / `PROVIDER_FAILURE` / `DOWNLOAD_FAILURE` /
`UNSUPPORTED_MEDIA` / `PROCESSING_LIMIT` / (future) `MEDIA_LIMIT_REACHED` remain
distinct outcomes wherever the architecture supports them (today: `MediaSafetyVerdict`
+ `MediaFailureKind` in `media-moderation.ts`). `SAFE` is not the same as
`PROVIDER_FAILURE` — but both must resolve to no destructive porn-related action.
None of the following should ever automatically become `EXPLICIT`: provider timeout,
provider outage, auth failure, rate limit, malformed response, ffmpeg failure,
download failure, unsupported codec, oversized media, processing limit, or monthly
media-entitlement exhaustion. (This is already the enforced behavior of
`decideMediaEnforcement` today for every currently-defined failure kind; the future
`MEDIA_LIMIT_REACHED` outcome must follow the identical rule when implemented.)

### Current media moderation architecture (preserve, do not weaken for entitlement reasons)
- Direct uploaded Telegram photos/videos only.
- A specialized visual-safety provider (Sightengine today, replaceable).
- Never routed through DeepSeek/Claude conversational paths.
- Bounded representative video-frame sampling, never frame-by-frame.
- Early exit after a sufficiently high-confidence explicit result.
- Bounded file-size/duration/resource processing.
- Guaranteed temp-file cleanup.
- Dedup/idempotency, one coordinated moderation path.
- Safe content passes; borderline/uncertain never auto-triggers destructive action;
  classifier/provider failures are never explicit content.

---

## 4. Future add-ons (NOT priced or implemented — direction only)

**Media capacity add-ons** (exact pricing TBD from real provider cost + usage data):
`+5,000` / `+10,000` / `+25,000` Media Moderation Units, or custom Enterprise
media-processing capacity. Initially, use the included hard caps only — no add-on
purchase flow exists yet.

**Infrastructure add-ons** (direction only, not implemented): additional persistent
storage, additional bandwidth, additional media-moderation capacity, higher
concurrency profiles, higher media-processing capacity, extended audit-log
retention, dedicated workers, dedicated database/infrastructure capacity, custom
Enterprise resource profiles.

---

## 5. Pricing economics (why Enterprise BYO isn't cheaper than it looks)

Even under BYO (where the customer pays for their own conversational AI credentials),
Innvil still pays for and operates: hosting, database, queues/workers, Telegram
processing, storage, bandwidth, photo/video processing, ffmpeg/frame extraction,
external media-safety classification, monitoring, audit/logging infrastructure,
security, tenant isolation, support, and general operational overhead. This is why
future Enterprise BYO pricing is positioned at $599/$799 rather than a lower
BYO-implies-cheap assumption.

---

## 6. Customer-facing pricing example (for future plan-card copy)

```
Basic — $49.99/month
  2 moderator slots
  500 included media moderation units

Standard — $129.99/month
  5 moderator slots
  2,000 included media moderation units

Premium — $219.99/month
  10 moderator slots
  5,000 included media moderation units

Pro — $379.99/month
  20 moderator slots
  10,000 included media moderation units

Enterprise BYO 50 — $599/month
  up to 50 moderator deployments
  20,000 included media moderation units
  25 GB persistent storage
  500 GB monthly bandwidth
  customer-owned supported x-API — no Innvil conversational API fallback

Enterprise BYO Unlimited — $799/month
  unlimited licensed moderator deployments
  30,000 included media moderation units
  100 GB persistent storage
  2 TB monthly bandwidth
  customer-owned supported x-API — no Innvil conversational API fallback
  platform fair-use / infrastructure safeguards apply
```

Never advertise internal CPU/RAM/worker-concurrency numbers as though the customer
is purchasing a VPS.

---

## 7. Resource/usage dashboard (future implementation, not built now)

Keep resource types independently visible, e.g.:

```
Moderator deployments        N / capacity
Media moderation             7,420 / 20,000 units
Persistent storage           12.3 GB / 25 GB
Monthly bandwidth            183 GB / 500 GB
Provider health               ...
```

Media usage may eventually break down into: photos classified, video frames
classified, total units used, monthly reset date. Not implemented in this pass.

---

## 8. Dashboard promotion (future direction, preserved from the earlier Enterprise notes)

Normal Virtual Moderator dashboard may show contextual Enterprise promotion,
Campaign promotion, Innvil.cloud discovery, and relevant feature recommendations.
Enterprise dashboard: quieter premium cross-sell (Campaigns, Innvil.cloud, future
infrastructure add-ons, new Enterprise capabilities). **Never** show promotions on
moderation-incident screens, provider/API failure screens, security pages,
destructive-action confirmations, or critical billing errors. Preferred UI language:
"More from Innvil" / "Discover Innvil" / "Recommendations" — not generic
"Advertisements."

---

## 9. Keep these concepts independent

Moderator slots, communities, Media Moderation Units, persistent storage, bandwidth,
Auto-Posting, conversational AI usage, API source (BYO vs. Innvil Managed),
moderation, infrastructure concurrency, and billing mode must remain **independent
concepts** — never collapsed into one entitlement unless a future, explicit product
decision bundles them.

---

## 10. Current development priority (restated)

**ENTERPRISE IMPLEMENTATION IS FUTURE WORK. DO NOT START IT** without an explicit,
separate implementation request. The active engineering priority remains **Telegram
Virtual Moderator refinement/debugging**, including: Sightengine integration
follow-through, photo moderation production review, provider-response
normalization, false-positive handling, media-moderation reliability, Vercel
production verification, ffmpeg/video verification, moderator behavior correctness,
Telegram reliability, Coordinator/idempotency, knowledge retrieval, AI routing
correctness, and ongoing bug fixing. Enterprise/pricing planning must not distract
from current moderator stabilization.
