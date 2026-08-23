import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { providerKeySecret } from "@/src/lib/supabase/admin";

/**
 * BYO Enterprise -- Phase 1 (2026-08-23): real, pgcrypto-encrypted storage
 * for a BYO account's own AI provider credential. Reuses the SAME
 * encryption convention already established for SMM provider keys /
 * payment gateway keys / Telegram bot tokens (PROVIDER_KEY_SECRET-keyed
 * pgp_sym_encrypt/decrypt, migration 0092) -- never a new/weaker secret
 * storage mechanism.
 *
 * DELIBERATE SCOPE BOUNDARY, stated plainly: this module is the DATA LAYER
 * ONLY. Storing or retrieving a credential here does NOT change any live
 * AI call anywhere in the moderation/chatter/media-classification runtime
 * -- every one of those still uses Innvil's own credential today,
 * regardless of what's stored here. Wiring the actual runtime to use a
 * BYO account's stored credential instead (and enforcing the "BYO must
 * never silently fall back to an Innvil-owned credential" invariant) is a
 * separate, deliberately deferred, safety-critical follow-up pass -- not
 * built yet. Do not import this module from any AI-generation call site
 * (chatter-generate.ts, media-safety-provider.ts, autopost-generate.ts,
 * bot-manager-classify.ts, link-classify.ts, media-warning.ts) until that
 * follow-up is explicitly built and tested.
 */

export type WatchByoProvider = "anthropic" | "openai";

export interface WatchByoCredential {
  provider: WatchByoProvider;
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}

export interface SetWatchByoCredentialInput {
  provider: WatchByoProvider;
  apiKey: string;
  baseUrl?: string | null;
  model?: string | null;
}

/** Cheap existence check -- never decrypts, safe for UI/gating use. */
export async function hasByoCredential(admin: SupabaseClient, accountId: string): Promise<boolean> {
  const { data } = await admin.from("watch_byo_provider_credentials").select("account_id").eq("account_id", accountId).maybeSingle();
  return data != null;
}

/** The account's decrypted BYO credential, or null if none is stored (a
 *  real, expected state -- never an error). Never logs or otherwise
 *  surfaces the decrypted key beyond this return value. */
export async function getAccountByoCredential(admin: SupabaseClient, accountId: string): Promise<WatchByoCredential | null> {
  const { data, error } = await admin.rpc("get_watch_byo_credential", { p_account_id: accountId, p_secret: providerKeySecret() });
  if (error) {
    console.error("[watch-byo] get_watch_byo_credential failed", accountId, error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { provider: string; api_key: string | null; base_url: string | null; model: string | null } | undefined;
  if (!row || !row.api_key) return null;
  return { provider: row.provider as WatchByoProvider, apiKey: row.api_key, baseUrl: row.base_url, model: row.model };
}

/** Stores (or replaces) the account's BYO credential -- one credential per
 *  account, upserted. Never returns the key back to the caller. */
export async function setAccountByoCredential(admin: SupabaseClient, accountId: string, input: SetWatchByoCredentialInput): Promise<void> {
  const { error } = await admin.rpc("set_watch_byo_credential", {
    p_account_id: accountId,
    p_provider: input.provider,
    p_key: input.apiKey,
    p_secret: providerKeySecret(),
    p_base_url: input.baseUrl ?? null,
    p_model: input.model ?? null,
  });
  if (error) throw new Error(`Could not store BYO credential: ${error.message}`);
}

export async function clearAccountByoCredential(admin: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await admin.from("watch_byo_provider_credentials").delete().eq("account_id", accountId);
  if (error) throw new Error(`Could not clear BYO credential: ${error.message}`);
}
