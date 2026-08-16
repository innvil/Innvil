/**
 * Innvil Virtual Moderator — panel-level add-on subscription + capability
 * entitlements. Mirrors src/lib/plans.ts (Campaign Automation): pure
 * readX/hasX functions over panels.settings.addons.moderator, no new
 * billing/entitlement engine. Runtime code must call these capability
 * checks (virtualMod*) instead of branching on tier name, trial state, or
 * commercial mode directly — monetization/trial establishes entitlement,
 * the runtime only ever reads capability flags.
 *
 * Three independent axes:
 *   - commercialMode: "commission" (Innvil sells to the end customer, owner
 *     gets MODERATOR_COMMISSION_SHARE) or "rental" (owner buys capacity at
 *     MODERATOR_RENTAL_DISCOUNT below list price and re-sells at their own
 *     price). Purely a billing/revenue-split concern, paid tiers only.
 *   - tier: basic/standard/premium/pro — PAID capacity + capability level.
 *   - trial: a first-class entitlement SOURCE in its own right (not a tier),
 *     active for 7 days from first deployment activation, broader in feature
 *     access than Basic but capped at 1 community/1 moderator/1 active slot
 *     and excludes content generation. A paid tier always supersedes an
 *     active trial once purchased. Trial ELIGIBILITY is tracked per OWNER
 *     ACCOUNT (moderator_trial_usage, 0044) — not per panel — so an owner
 *     can't get a fresh trial by spinning up another panel.
 */

import { MODERATOR_COMMUNITY_CAPACITY, type ModeratorPlanTier } from "@/src/lib/money";

/** Master switch — OFF (in production) while the foundation (domain model,
 *  Manager Bot provisioning, adapter, coordinator, runtime) is still being
 *  built. The owner-app "Virtual Moderator" tab shows a "coming soon" teaser
 *  instead of the real controls while this is false (mirrors
 *  DESIGN_TOOLS_ENABLED in src/lib/plans.ts).
 *
 *  Env-driven (NEXT_PUBLIC_* so the client component can read it too) rather
 *  than a hardcoded constant, specifically so it can be turned on for a
 *  Vercel Preview/dev environment to test the real flow without risking an
 *  accidental "flip true, forget to revert" commit reaching production.
 *  Leave NEXT_PUBLIC_VIRTUAL_MODERATOR_ENABLED unset (or "false") in
 *  Production; set it to "true" only on the environment you're testing in. */
export const VIRTUAL_MODERATOR_ENABLED = process.env.NEXT_PUBLIC_VIRTUAL_MODERATOR_ENABLED === "true";

export type { ModeratorPlanTier };
export type ModeratorCommercialMode = "commission" | "rental";
export type ModeratorEntitlementSource = "trial" | ModeratorPlanTier | null;

const TIERS: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro"];
const MODES: ModeratorCommercialMode[] = ["commission", "rental"];

/** §45/§46: 7-day trial, clock starts when the first ModeratorDeployment goes ACTIVE. */
export const TRIAL_DURATION_DAYS = 7;
/** §38/§39: one shared proactive budget/local-community-day, across GM/GN/revival/starters. Not yet enforced (Proactive Mode isn't built) — stored now so later phases don't have to retrofit the schema. */
export const TRIAL_PROACTIVE_DAILY_LIMIT = 2;
/** Phase 4.M (B): 20 successfully-executed REACTIVE conversational text
 *  responses (CASUAL_CHAT/ANSWER/SHORT_ACK) per community per local
 *  community day, trial only — a maximum, not a target. Separate from
 *  TRIAL_PROACTIVE_DAILY_LIMIT above; moderation is never gated by it. Paid
 *  tiers are unaffected (this patch is trial-only per spec §2). */
export const TRIAL_REACTIVE_DAILY_LIMIT = 20;

export interface ModeratorTrialState {
  active: boolean;
  startedAt: string | null;
  endsAt: string | null;
}

const TRIAL_OFF: ModeratorTrialState = { active: false, startedAt: null, endsAt: null };

export interface ModeratorAddonSub {
  tier: ModeratorPlanTier | null;
  commercialMode: ModeratorCommercialMode;
  since: string | null;
  lastChargeAt: string | null;
  nextChargeAt: string | null;
  /** true when a scheduled charge failed for lack of balance (paused until funded). Only meaningful for rental. */
  lapsed: boolean;
  trial: ModeratorTrialState;
}

const OFF: ModeratorAddonSub = {
  tier: null,
  commercialMode: "commission",
  since: null,
  lastChargeAt: null,
  nextChargeAt: null,
  lapsed: false,
  trial: { ...TRIAL_OFF },
};

function readTrialState(value: unknown): ModeratorTrialState {
  if (!value || typeof value !== "object") return { ...TRIAL_OFF };
  const o = value as Record<string, unknown>;
  const startedAt = typeof o.startedAt === "string" ? o.startedAt : null;
  const endsAt = typeof o.endsAt === "string" ? o.endsAt : null;
  // "active" is derived from endsAt, not trusted from stored state — a stale
  // `active: true` left over after expiry must never grant entitlements.
  const active = !!endsAt && new Date(endsAt).getTime() > Date.now();
  return { active, startedAt, endsAt };
}

export function readModeratorAddon(settings: unknown): ModeratorAddonSub {
  if (settings && typeof settings === "object") {
    const addons = (settings as Record<string, unknown>).addons;
    if (addons && typeof addons === "object") {
      const raw = (addons as Record<string, unknown>).moderator;
      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const tier = TIERS.includes(o.tier as ModeratorPlanTier) ? (o.tier as ModeratorPlanTier) : null;
        const commercialMode = MODES.includes(o.commercialMode as ModeratorCommercialMode)
          ? (o.commercialMode as ModeratorCommercialMode)
          : "commission";
        return {
          tier,
          commercialMode,
          since: typeof o.since === "string" ? o.since : null,
          lastChargeAt: typeof o.lastChargeAt === "string" ? o.lastChargeAt : null,
          nextChargeAt: typeof o.nextChargeAt === "string" ? o.nextChargeAt : null,
          lapsed: o.lapsed === true,
          trial: readTrialState(o.trial),
        };
      }
    }
  }
  return { ...OFF };
}

export function moderatorTier(settings: unknown): ModeratorPlanTier | null {
  return readModeratorAddon(settings).tier;
}

/** A paid tier always supersedes an active trial (§47 — purchasing ends trial preview access). */
export function moderatorEntitlementSource(settings: unknown): ModeratorEntitlementSource {
  const addon = readModeratorAddon(settings);
  if (addon.tier) return addon.tier;
  if (addon.trial.active) return "trial";
  return null;
}

/** True when this panel currently has ANY active Virtual Moderator entitlement (paid tier or live trial). */
export function hasVirtualModerator(settings: unknown): boolean {
  return moderatorEntitlementSource(settings) !== null;
}

/* ------------------------------------------------------------- capacity ---- */

export interface ModeratorCapacity {
  maxCommunities: number;
  maxActiveSlots: number;
}

/** Exported so the customer-facing entitlement layer (customer-entitlement.ts)
 *  can reuse the exact same tier->slots numbers rather than duplicating them —
 *  the tier names and Active Moderator Slot counts are shared between the
 *  legacy owner-facing model and the storefront customer product; only WHO
 *  holds the entitlement and WHO pays differs. maxCommunities here is the
 *  INCLUDED count (money.ts's MODERATOR_COMMUNITY_CAPACITY[tier].included) —
 *  single source, not duplicated. The separate paid-expansion ceiling
 *  (Premium up to 5, Pro up to 10) lives in moderatorCommunityExpansionCeiling
 *  below, reading the same money.ts table. */
export const CAPACITY: Record<ModeratorPlanTier, ModeratorCapacity> = {
  basic: { maxCommunities: MODERATOR_COMMUNITY_CAPACITY.basic.included, maxActiveSlots: 2 },
  standard: { maxCommunities: MODERATOR_COMMUNITY_CAPACITY.standard.included, maxActiveSlots: 5 },
  premium: { maxCommunities: MODERATOR_COMMUNITY_CAPACITY.premium.included, maxActiveSlots: 10 },
  pro: { maxCommunities: MODERATOR_COMMUNITY_CAPACITY.pro.included, maxActiveSlots: 20 },
};

/** §37/§50: trial capacity is fixed and separate from any paid tier's table. */
export const TRIAL_CAPACITY: ModeratorCapacity = { maxCommunities: 1, maxActiveSlots: 1 };
/** §44/§50: trial also caps how many VirtualModerator identities may be created at all (not just active ones). */
export const TRIAL_MAX_SAVED_MODERATORS = 1;

/** Flat per-community cap on ACTIVE Innvil moderator deployments, independent
 *  of tier — even a pro panel with 20 total Active Mod Slots may deploy at
 *  most this many Innvil-connected bots into any ONE community, to keep
 *  bot-to-bot acknowledgement traffic sane. This governs Innvil's own
 *  connection only; it has no bearing on how many bots the owner adds to the
 *  Telegram group directly (outside Innvil). Enforced in connectCommunity/
 *  setDeploymentEnabled in src/lib/actions/moderator.ts, not here. */
export const MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY = 5;

/** Active Mod Slot / community capacity for the panel's current entitlement source (zero if none). */
export function moderatorCapacity(settings: unknown): ModeratorCapacity {
  const source = moderatorEntitlementSource(settings);
  if (source === "trial") return TRIAL_CAPACITY;
  if (source) return CAPACITY[source];
  return { maxCommunities: 0, maxActiveSlots: 0 };
}

/** The ceiling paid additional-community purchases may reach for the current
 *  entitlement source (Basic/Standard: hard-capped, no expansion; Premium: up
 *  to 5; Pro: up to 10; trial: fixed at TRIAL_CAPACITY). Purchasing the
 *  add-on itself is not yet wired to an action (Phase 4.N auto-posting isn't
 *  built) — this only defines the ceiling the future purchase flow must
 *  respect, from the single money.ts source. */
export function moderatorCommunityExpansionCeiling(settings: unknown): number {
  const source = moderatorEntitlementSource(settings);
  if (source === "trial") return TRIAL_CAPACITY.maxCommunities;
  if (source) return MODERATOR_COMMUNITY_CAPACITY[source].maxWithAddons;
  return 0;
}

/** Max saved VirtualModerator identities (distinct from active deployment
 *  slots, §63 of the PDF / §50 here) — mirrors the tier's Active Mod Slot
 *  count (2/5/10/20), since a persona a subscriber can't ever deploy isn't
 *  worth letting them save either. */
export function moderatorMaxSavedModerators(settings: unknown): number {
  const source = moderatorEntitlementSource(settings);
  if (source === "trial") return TRIAL_MAX_SAVED_MODERATORS;
  if (source) return CAPACITY[source].maxActiveSlots;
  return 0;
}

/* ---------------------------------------------------------- capabilities ---- */
// Runtime code asks these, never `if (tier === "standard")` or `if (trial.active)` directly.

/** Reactive natural chatter — any active entitlement, including trial and Basic (§15/§37). */
export function virtualModNaturalChatter(settings: unknown): boolean {
  return hasVirtualModerator(settings);
}

/** Proactive Mode (GM/GN, dead-chat revival, conversation starters) — Standard+ OR an active trial (§15/§37). */
export function virtualModProactiveMode(settings: unknown): boolean {
  const source = moderatorEntitlementSource(settings);
  return source === "trial" || source === "standard" || source === "premium" || source === "pro";
}

/** Long-term Community Memory — Standard+ or trial (§18/§37). */
export function virtualModCommunityMemory(settings: unknown): boolean {
  return virtualModProactiveMode(settings);
}

/** Full custom personality (beyond presets) — Standard+ or trial (§15/§37). */
export function virtualModCustomPersonality(settings: unknown): boolean {
  return virtualModProactiveMode(settings);
}

/** Business knowledge grounding — any active entitlement, including trial (§37). */
export function virtualModBusinessKnowledge(settings: unknown): boolean {
  return hasVirtualModerator(settings);
}

/** Moderation capability — any active entitlement, including trial and Basic. */
export function virtualModModeration(settings: unknown): boolean {
  return hasVirtualModerator(settings);
}

/** Advanced moderation behavior — Standard+ or trial (trial exposes it even though it's a Standard+ paid feature, §37). */
export function virtualModAdvancedModeration(settings: unknown): boolean {
  return virtualModProactiveMode(settings);
}

/** Analytics — any active entitlement, including trial (§37). */
export function virtualModAnalytics(settings: unknown): boolean {
  return hasVirtualModerator(settings);
}

/** Content generation / autoposting / scheduled publishing (Phase 4.N part B) —
 *  any active PAID tier (Basic and up); the trial explicitly stays excluded
 *  even though it exposes most other capabilities (spec §26 of
 *  project-knowledge-autoposting-spec.md: "the previously approved trial
 *  currently excludes AI content generation for campaigns, autoposting,
 *  scheduled content publishing"). Master rollout switch is
 *  AUTO_POSTING_ENABLED below, same env-driven pattern as the other
 *  Virtual Moderator feature flags. */
export function virtualModContentGeneration(settings: unknown): boolean {
  return AUTO_POSTING_ENABLED && !!moderatorTier(settings);
}

/** Master switch for AI Telegram Auto-Posting — OFF in production until the
 *  scheduling/generation/publishing pipeline is live-verified. Same
 *  env-driven pattern as VIRTUAL_MODERATOR_ENABLED/BOT_ACKNOWLEDGEMENT_ENABLED/
 *  NATURAL_CHATTER_ENABLED. */
export const AUTO_POSTING_ENABLED = process.env.NEXT_PUBLIC_AUTO_POSTING_ENABLED === "true";

/** Master switch for direct photo/video moderation (Phase 4.M media
 *  moderation) — OFF until a real MEDIA_SAFETY_PROVIDER_URL/API_KEY is
 *  configured AND live-verified (no vendor is wired by default — see
 *  media-safety-provider.ts). Photo and video are independently gated:
 *  video additionally requires ffmpeg-static's Linux binary to be verified
 *  on Vercel's actual build/runtime before enabling, so photo moderation
 *  can ship without waiting on that. Not a separate entitlement axis from
 *  the rest of moderation — gated by the SAME virtualModModeration
 *  capability check, matching "keep the UI simple, one unified moderation
 *  toggle" rather than adding a new per-panel setting. */
export const MEDIA_MODERATION_ENABLED = process.env.NEXT_PUBLIC_MEDIA_MODERATION_ENABLED === "true";
export const MEDIA_MODERATION_VIDEO_ENABLED = process.env.NEXT_PUBLIC_MEDIA_MODERATION_VIDEO_ENABLED === "true";

/** Direct-media (photo) moderation capability — reuses the existing
 *  moderation entitlement (any active tier or trial, same as link/spam
 *  moderation) rather than introducing a new toggle. */
export function virtualModMediaModeration(settings: unknown): boolean {
  return MEDIA_MODERATION_ENABLED && virtualModModeration(settings);
}

export function virtualModVideoModeration(settings: unknown): boolean {
  return MEDIA_MODERATION_VIDEO_ENABLED && virtualModMediaModeration(settings);
}

/** Master switch for "Innvil Moderator Acknowledgement" (bot-to-bot ack between
 *  Innvil moderators in the same community) — OFF in production until Telegram's
 *  bot-to-bot delivery configuration (§14/§15 of the bot-ack spec) and loop
 *  safeguards are verified live. Same env-driven pattern as VIRTUAL_MODERATOR_ENABLED. */
export const BOT_ACKNOWLEDGEMENT_ENABLED = process.env.NEXT_PUBLIC_BOT_ACKNOWLEDGEMENT_ENABLED === "true";

/** Capability gate — any active entitlement (paid tier or trial) may use bot
 *  acknowledgement once the master switch is on; not tier-gated further for
 *  v1 since it's a lightweight, deterministic (no-AI) behavior, not a premium
 *  feature. Revisit if/when product wants to restrict it to specific tiers. */
export function virtualModBotAcknowledgement(settings: unknown): boolean {
  return BOT_ACKNOWLEDGEMENT_ENABLED && hasVirtualModerator(settings);
}

/** Master switch for Reactive Natural Chatter (real AI-generated replies to
 *  human community messages) — OFF in production until live-tested. This is
 *  the flagship "bot behaves like a community member" behavior, available on
 *  any active entitlement including trial (virtualModNaturalChatter already
 *  covers the entitlement side); this flag is purely a rollout/kill-switch,
 *  same env-driven pattern as VIRTUAL_MODERATOR_ENABLED/BOT_ACKNOWLEDGEMENT_ENABLED. */
export const NATURAL_CHATTER_ENABLED = process.env.NEXT_PUBLIC_NATURAL_CHATTER_ENABLED === "true";

export function virtualModNaturalChatterActive(settings: unknown): boolean {
  return NATURAL_CHATTER_ENABLED && virtualModNaturalChatter(settings);
}
