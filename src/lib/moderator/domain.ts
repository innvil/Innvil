/* =========================================================
   Virtual Moderator — core domain types (pure, serializable).
   No provider calls, no "use server", no UI. Mirrors the tables in
   supabase/migrations/0044_virtual_moderator.sql. Types only — every
   consumer (server actions, adapters, UI) imports from here so the
   domain boundaries (moderator vs bot identity vs community vs
   deployment) can't collapse back into one blob.
   ========================================================= */

import {
  MODERATOR_PERSONALITY_PRESETS,
  normalizeModeratorPersonality,
  type ModeratorPersonalityPreset,
  type ModeratorProvisioningStatus,
} from "./provisioning";

export { MODERATOR_PERSONALITY_PRESETS, normalizeModeratorPersonality };
export type { ModeratorPersonalityPreset, ModeratorProvisioningStatus };

/* ------------------------------------------------------------- persona ---- */

export interface ModeratorPersona {
  language: string;          // e.g. "en", "en+tl" (Taglish)
  formality: number;         // 0-100
  humor: number;             // 0-100
  slang: number;             // 0-100
  emojiFrequency: number;    // 0-100
  teasing: number;           // 0-100
  chattiness: number;        // 0-100
  profanityTolerance: number; // 0-100
  topicsToAvoid: string[];
  customInstructions: string;
}

export const DEFAULT_MODERATOR_PERSONA: ModeratorPersona = {
  language: "en",
  formality: 30,
  humor: 50,
  slang: 40,
  emojiFrequency: 30,
  teasing: 30,
  chattiness: 40,
  profanityTolerance: 10,
  topicsToAvoid: [],
  customInstructions: "",
};

export function normalizeModeratorPersona(value: unknown): ModeratorPersona {
  if (!value || typeof value !== "object") return { ...DEFAULT_MODERATOR_PERSONA };
  const raw = value as Record<string, unknown>;
  const pct = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), 100) : fallback;
  return {
    language: typeof raw.language === "string" && raw.language ? raw.language : DEFAULT_MODERATOR_PERSONA.language,
    formality: pct(raw.formality, DEFAULT_MODERATOR_PERSONA.formality),
    humor: pct(raw.humor, DEFAULT_MODERATOR_PERSONA.humor),
    slang: pct(raw.slang, DEFAULT_MODERATOR_PERSONA.slang),
    emojiFrequency: pct(raw.emojiFrequency, DEFAULT_MODERATOR_PERSONA.emojiFrequency),
    teasing: pct(raw.teasing, DEFAULT_MODERATOR_PERSONA.teasing),
    chattiness: pct(raw.chattiness, DEFAULT_MODERATOR_PERSONA.chattiness),
    profanityTolerance: pct(raw.profanityTolerance, DEFAULT_MODERATOR_PERSONA.profanityTolerance),
    topicsToAvoid: Array.isArray(raw.topicsToAvoid)
      ? raw.topicsToAvoid.filter((v): v is string => typeof v === "string").slice(0, 20)
      : [],
    customInstructions: typeof raw.customInstructions === "string" ? raw.customInstructions.slice(0, 2000) : "",
  };
}

/* --------------------------------------------------------- provisioning ---- */

export interface ModeratorProvisioningDraft {
  requestedUsername: string;
  avatarUrl: string | null;
  personalityPreset: ModeratorPersonalityPreset;
}

export const DEFAULT_PROVISIONING_DRAFT: ModeratorProvisioningDraft = {
  requestedUsername: "",
  avatarUrl: null,
  personalityPreset: "casual",
};

export function normalizeProvisioningDraft(value: unknown): ModeratorProvisioningDraft {
  if (!value || typeof value !== "object") return { ...DEFAULT_PROVISIONING_DRAFT };
  const raw = value as Record<string, unknown>;
  return {
    requestedUsername: typeof raw.requestedUsername === "string" ? raw.requestedUsername.trim() : "",
    avatarUrl: typeof raw.avatarUrl === "string" && raw.avatarUrl ? raw.avatarUrl : null,
    personalityPreset: normalizeModeratorPersonality(raw.personalityPreset),
  };
}

/* ----------------------------------------------------- virtual moderator ---- */

export type VirtualModeratorStatus = "draft" | "active" | "paused" | "archived";

export interface VirtualModerator {
  id: string;
  panelId: string;
  name: string;
  status: VirtualModeratorStatus;
  persona: ModeratorPersona;
  provisioningStatus: ModeratorProvisioningStatus;
  provisioningDraft: ModeratorProvisioningDraft;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------------------------- telegram bot integration ---- */

export type TelegramCredentialSource = "managed" | "botfather";
export type TelegramManagerRelationship = "pending" | "active" | "revoked" | "unknown";

export interface TelegramBotIntegration {
  id: string;
  panelId: string;
  virtualModeratorId: string;
  telegramBotId: number | null;
  username: string | null;
  source: TelegramCredentialSource;
  managerRelationship: TelegramManagerRelationship;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // credential_enc is NEVER exposed here — decrypted only server-side, on demand.
}

/* -------------------------------------------------------------- community ---- */

export type CommunityChatType = "group" | "supergroup" | "channel" | "private" | "unknown";

export interface Community {
  id: string;
  panelId: string;
  platform: "telegram";
  chatId: string;
  handle: string | null;
  title: string | null;
  chatType: CommunityChatType | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------- deployment ---- */

export type ModeratorRole =
  | "general"
  | "chatter"
  | "moderation"
  | "engagement"
  | "content"
  | "business_knowledge";

export const MODERATOR_ROLES: Array<{ key: ModeratorRole; label: string }> = [
  { key: "general", label: "General" },
  { key: "chatter", label: "Chatter / Engagement" },
  { key: "moderation", label: "Moderation" },
  { key: "engagement", label: "Engagement" },
  { key: "content", label: "Content" },
  { key: "business_knowledge", label: "Business knowledge" },
];

export interface DeploymentHealth {
  present: boolean;
  canSend: boolean;
  canDelete: boolean;
  canRestrict: boolean;
  checkedAt: string | null;
}

export const DEFAULT_DEPLOYMENT_HEALTH: DeploymentHealth = {
  present: false,
  canSend: false,
  canDelete: false,
  canRestrict: false,
  checkedAt: null,
};

export interface ModerationOverrides {
  deleteSpamMessages: boolean;
  banSpammers: boolean;
  banAfterHits: number;
  triggerKeywords: string[];
}

export const DEFAULT_MODERATION_OVERRIDES: ModerationOverrides = {
  deleteSpamMessages: true,
  banSpammers: true,
  banAfterHits: 1,
  triggerKeywords: ["promo", "cashapp", "telegram me", "dm me", "airdrop", "investment", "crypto"],
};

export interface DeploymentOverrides {
  personaOverrides: Partial<ModeratorPersona>;
  moderation: ModerationOverrides;
  proactiveEnabled: boolean;
}

export const DEFAULT_DEPLOYMENT_OVERRIDES: DeploymentOverrides = {
  personaOverrides: {},
  moderation: { ...DEFAULT_MODERATION_OVERRIDES },
  proactiveEnabled: false,
};

export function normalizeModerationOverrides(value: unknown): ModerationOverrides {
  if (!value || typeof value !== "object") return { ...DEFAULT_MODERATION_OVERRIDES };
  const raw = value as Record<string, unknown>;
  const triggerKeywords = Array.isArray(raw.triggerKeywords)
    ? raw.triggerKeywords.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 20)
    : [...DEFAULT_MODERATION_OVERRIDES.triggerKeywords];
  const banAfterHits =
    typeof raw.banAfterHits === "number" && Number.isFinite(raw.banAfterHits)
      ? Math.min(Math.max(Math.floor(raw.banAfterHits), 1), 10)
      : DEFAULT_MODERATION_OVERRIDES.banAfterHits;
  return {
    deleteSpamMessages: raw.deleteSpamMessages !== false,
    banSpammers: raw.banSpammers !== false,
    banAfterHits,
    triggerKeywords,
  };
}

export function normalizeDeploymentOverrides(value: unknown): DeploymentOverrides {
  if (!value || typeof value !== "object") return { ...DEFAULT_DEPLOYMENT_OVERRIDES };
  const raw = value as Record<string, unknown>;
  return {
    personaOverrides:
      raw.personaOverrides && typeof raw.personaOverrides === "object"
        ? (raw.personaOverrides as Partial<ModeratorPersona>)
        : {},
    moderation: normalizeModerationOverrides(raw.moderation),
    proactiveEnabled: raw.proactiveEnabled === true,
  };
}

/** Effective persona for a deployment = base persona + this deployment's overrides. */
export function effectivePersona(base: ModeratorPersona, overrides: DeploymentOverrides): ModeratorPersona {
  return { ...base, ...overrides.personaOverrides };
}

export interface ModeratorDeployment {
  id: string;
  panelId: string;
  moderatorId: string;
  communityId: string;
  enabled: boolean;
  role: ModeratorRole;
  overrides: DeploymentOverrides;
  health: DeploymentHealth;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentState {
  deploymentId: string;
  lastSpokeAt: string | null;
  messagesRecent: number;
  consecutiveMessages: number;
  proactiveActionsToday: number;
  lastProactiveAt: string | null;
  topicSummary: string | null;
  updatedAt: string;
}
