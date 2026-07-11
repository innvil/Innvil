import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES RLS. Server-only (guarded by the
 * `server-only` import: any accidental client import fails the build).
 *
 * Use exclusively in trusted server code: reading/writing provider API keys
 * (via set_provider_key / get_provider_key), forwarding orders, and applying
 * balance changes (apply_balance_change). Never expose this client, its results
 * containing secrets, or the service-role key to the browser.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** The pgcrypto secret used to encrypt/decrypt provider API keys server-side. */
export function providerKeySecret(): string {
  const secret = process.env.PROVIDER_KEY_SECRET;
  if (!secret) throw new Error("PROVIDER_KEY_SECRET is not set");
  return secret;
}
