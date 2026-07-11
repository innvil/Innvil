import "server-only";
import { createClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import type { ProfileRow, UserRole } from "@/src/types/db";

/**
 * Server-side auth helpers. RLS-aware: reads run as the signed-in user via the
 * cookie-based server client. Profile creation uses the service-role client
 * because `profiles` has no self-insert policy (rows are created by the
 * auth.users trigger, or by this fallback when that trigger couldn't install).
 */

/** The authenticated Supabase user, or null. Validates the JWT with the auth server. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns a server client together with the current user. Calling getUser() here
 * hydrates the session ON THIS client, so any DB query made with the returned
 * `supabase` carries the user's JWT (and RLS `auth.uid()` resolves correctly).
 * Use for reads where RLS should scope results.
 */
export async function getAuthedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Validated identity + a service-role client that BYPASSES RLS. Use in trusted
 * server actions that enforce ownership in code (e.g. force owner_id = user.id,
 * or verify a panel belongs to the user before touching it). `user` is validated
 * against the auth server; `admin` must never be exposed to the client.
 */
export async function getAuthedAdmin() {
  const user = await getUser();
  return { user, admin: createAdminClient() };
}

/** The current user's profile row, or null. */
export async function getProfile(): Promise<ProfileRow | null> {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return (data as ProfileRow) ?? null;
}

/**
 * Ensure a profile row exists for a user (fallback for the auth.users trigger).
 * Insert-if-absent — never overwrites an existing role/display_name.
 */
export async function ensureProfile(
  userId: string,
  role: UserRole = "panel_owner",
  displayName?: string | null
) {
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .upsert(
      { id: userId, role, display_name: displayName ?? null },
      { onConflict: "id", ignoreDuplicates: true }
    );
}

/** True when the current user holds one of the given roles. */
export async function hasRole(...roles: UserRole[]): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && roles.includes(profile.role);
}
