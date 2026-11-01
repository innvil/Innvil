import type { UserRole } from "@/src/types/db";

/** Public Innvil registration always creates a normal panel-owner account. */
export const PUBLIC_SIGNUP_ROLE: UserRole = "panel_owner";

/** Build the server-owned profile payload for an immediate-session signup. */
export function publicSignupProfile(userId: string, displayName?: string | null) {
  return {
    id: userId,
    role: PUBLIC_SIGNUP_ROLE,
    displayName: displayName ?? null,
  } as const;
}

/** Shared result for both immediate-session and email-confirmation signup. */
export function publicSignupOutcome(
  userId: string,
  hasSession: boolean,
  displayName?: string | null
) {
  return {
    profile: publicSignupProfile(userId, displayName),
    needsConfirmation: !hasSession,
  } as const;
}
