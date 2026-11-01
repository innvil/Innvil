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

/** Read only the server-written app_metadata marker; user_metadata is ignored. */
export function trustedRoleIntentFromAppMetadata(value: unknown): RecoverableProfileRole | null {
  if (!value || typeof value !== "object") return null;
  const intent = (value as { profile_role_intent?: unknown }).profile_role_intent;
  return intent === "panel_owner" || intent === "customer" ? intent : null;
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
