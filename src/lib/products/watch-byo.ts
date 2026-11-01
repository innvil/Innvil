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
 * RUNTIME WIRING (2026-08-24): the live AI runtime now DOES use a BYO
 * account's stored credential, for the call sites where it's actually
 * reachable -- but ONLY through ONE consumer, `resolveAccountAiRouting()`
 * in `watch-runtime.ts`, which resolves an account's routing decision ONCE
 * per inbound Telegram event and hands the already-resolved
 * `AccountAiRouting` value down to the generation modules
 * (chatter-generate.ts, link-classify.ts, media-warning.ts). None of those
 * modules import THIS file directly -- they only ever see the resolved
 * type, preserving this module's original decoupling from the generation
 * layer. `getAccountByoCredential`/`hasByoCredential` are otherwise still
 * called only from `watch-runtime.ts` and the devops grant tool
 * (`superadmin-watch-devops.ts`)/its UI/this file's own test.
 *
 * Deliberately NOT wired to BYO at all, confirmed by inspection (see the
 * Phase 2 plan's "Explicitly OUT of BYO scope" section): `media-safety-
 * provider.ts`/`sightengine-provider.ts` (a vision/NSFW classifier vendor
 * category this table's `provider` check has no way to represent -- Innvil
 * continues to own/pay for/meter it regardless of api_source_mode);
 * `bot-manager-classify.ts` (innvil_bot_manager is Innvil's own platform-
 * wide bot, with no per-account context to resolve BYO from at all);
 * `autopost-generate.ts` (Auto-Posting is entirely Panel-scoped --
 * `auto_post_windows.panel_id` is `not null` -- and Enterprise/BYO is
 * entirely account-scoped, so an Enterprise BYO account cannot currently
 * even create an Auto-Posting window; a pre-existing, separate gap, not
 * something this pass fixes).
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
