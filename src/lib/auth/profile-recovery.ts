import type { UserRole } from "@/src/types/db";

export type ProfileRecoveryEvidence = {
  hasCustomerAccount: boolean;
  ownsPanel: boolean;
  isPanelMember: boolean;
};

export type ProfileRecoveryDecision =
  | { ok: true; role: Exclude<UserRole, "super_admin"> }
  | { ok: false; reason: "role_unverified" | "conflicting_role_evidence" };

export type RecoverableProfileRole = "panel_owner" | "customer";

export const PROFILE_ROLE_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

export type ProfileRoleIntentInspection =
  | { ok: true; role: RecoverableProfileRole; expiresAt: string }
  | { ok: false; reason: "missing" | "malformed" | "expired" };

/** Build a short-lived marker using only trusted server time and role input. */
export function profileRoleIntentMetadata(
  role: RecoverableProfileRole,
  now = Date.now()
): { profile_role_intent: RecoverableProfileRole; profile_role_intent_expires_at: string } {
  return {
    profile_role_intent: role,
    profile_role_intent_expires_at: new Date(now + PROFILE_ROLE_INTENT_TTL_MS).toISOString(),
  };
}

/** Identify whether app metadata contains a role-intent marker at all. */
export function hasProfileRoleIntentMarker(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.profile_role_intent === "string"
    || typeof metadata.profile_role_intent_expires_at === "string";
}

/** Validate the server-written marker, including its expiration. */
export function inspectProfileRoleIntent(
  value: unknown,
  now = Date.now()
): ProfileRoleIntentInspection {
  if (!hasProfileRoleIntentMarker(value)) return { ok: false, reason: "missing" };
  if (!value || typeof value !== "object") return { ok: false, reason: "malformed" };

  const metadata = value as Record<string, unknown>;
  const role = metadata.profile_role_intent;
  const expiresAt = metadata.profile_role_intent_expires_at;
  if (
    (role !== "panel_owner" && role !== "customer")
    || typeof expiresAt !== "string"
    || !Number.isFinite(Date.parse(expiresAt))
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.parse(expiresAt) <= now) return { ok: false, reason: "expired" };
  return { ok: true, role, expiresAt };
}

/** Read only the server-written app_metadata marker; user_metadata is ignored. */
export function trustedRoleIntentFromAppMetadata(value: unknown): RecoverableProfileRole | null {
  const inspection = inspectProfileRoleIntent(value);
  return inspection.ok ? inspection.role : null;
}

/**
 * Resolve only roles that have an independent server-side database signal.
 * A missing profile never implies super_admin, and no client/user metadata is
 * considered here.
 */
export function resolveTrustedProfileRole(
  evidence: ProfileRecoveryEvidence
): ProfileRecoveryDecision {
  if (evidence.hasCustomerAccount && (evidence.ownsPanel || evidence.isPanelMember)) {
    return { ok: false, reason: "conflicting_role_evidence" };
  }
  if (evidence.ownsPanel) return { ok: true, role: "panel_owner" };
  if (evidence.isPanelMember) return { ok: true, role: "staff" };
  if (evidence.hasCustomerAccount) return { ok: true, role: "customer" };
  return { ok: false, reason: "role_unverified" };
}
