/* =========================================================
   Virtual Moderator provisioning state machine.
   Pure/serializable helpers for a resumable Telegram-managed onboarding flow.
   This file intentionally contains no provider calls or UI code.

   NOTE: this file no longer owns the moderator/community/commercial record
   shape (that collapsed a reusable VirtualModerator onto a single Community
   and a single monetization mode). Those live in ./domain.ts (VirtualModerator,
   Community, ModeratorDeployment, ...) and ./plan.ts (panel-level Virtual
   Moderator add-on subscription + capability entitlements). This file keeps
   only the provisioning STATUS enum/transitions, which were already correct.
   ========================================================= */

export type ModeratorProvisioningStatus =
  | "draft"
  | "telegram_confirmation_pending"
  | "telegram_created"
  | "credential_setup"
  | "bot_ready"
  | "community_setup_required"
  | "active"
  | "cancelled"
  | "username_unavailable"
  | "telegram_creation_failed"
  | "credential_setup_failed"
  | "expired"
  | "requires_retry";

export type ModeratorPersonalityPreset =
  | "casual"
  | "friendly"
  | "professional"
  | "gaming"
  | "sales"
  | "strict";

export const MODERATOR_PERSONALITY_PRESETS: Array<{
  key: ModeratorPersonalityPreset;
  label: string;
  description: string;
}> = [
  { key: "casual", label: "Casual", description: "Relaxed, human, low-friction" },
  { key: "friendly", label: "Friendly", description: "Warm, approachable, helpful" },
  { key: "professional", label: "Professional", description: "Clear, concise, brand-safe" },
  { key: "gaming", label: "Gaming", description: "Fast-paced, energetic, community-first" },
  { key: "sales", label: "Sales", description: "Conversion-oriented and persuasive" },
  { key: "strict", label: "Strict", description: "Tight moderation and firm boundaries" },
];

export const MODERATOR_PROVISIONING_STATUSES: ModeratorProvisioningStatus[] = [
  "draft",
  "telegram_confirmation_pending",
  "telegram_created",
  "credential_setup",
  "bot_ready",
  "community_setup_required",
  "active",
  "cancelled",
  "username_unavailable",
  "telegram_creation_failed",
  "credential_setup_failed",
  "expired",
  "requires_retry",
];

export function normalizeModeratorStatus(value: unknown): ModeratorProvisioningStatus {
  return typeof value === "string" && MODERATOR_PROVISIONING_STATUSES.includes(value as ModeratorProvisioningStatus)
    ? (value as ModeratorProvisioningStatus)
    : "draft";
}

export function normalizeModeratorPersonality(value: unknown): ModeratorPersonalityPreset {
  return typeof value === "string" && MODERATOR_PERSONALITY_PRESETS.some((preset) => preset.key === value)
    ? (value as ModeratorPersonalityPreset)
    : "casual";
}

export function nextModeratorStatuses(status: ModeratorProvisioningStatus): ModeratorProvisioningStatus[] {
  switch (status) {
    case "draft":
      return ["telegram_confirmation_pending", "cancelled"];
    case "telegram_confirmation_pending":
      return ["telegram_created", "requires_retry", "cancelled", "expired"];
    case "telegram_created":
      return ["credential_setup", "credential_setup_failed"];
    case "credential_setup":
      return ["bot_ready", "credential_setup_failed"];
    case "bot_ready":
      return ["community_setup_required", "active"];
    case "community_setup_required":
      return ["active", "requires_retry"];
    case "requires_retry":
      return ["telegram_confirmation_pending", "cancelled"];
    default:
      return [];
  }
}

export function isTerminalModeratorStatus(status: ModeratorProvisioningStatus): boolean {
  return ["cancelled", "username_unavailable", "telegram_creation_failed", "credential_setup_failed", "expired"].includes(status);
}
