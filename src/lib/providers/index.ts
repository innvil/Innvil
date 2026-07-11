import "server-only";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { ProviderCredentials, ProviderError } from "./types";

export * from "./types";
export * from "./client";

/**
 * Build provider credentials for server-side calls. The api key is decrypted via
 * the service-role-only `get_provider_key` RPC (pgcrypto) using PROVIDER_KEY_SECRET.
 *
 * IMPORTANT: this bypasses RLS, so the CALLER must have already authorized the
 * user against the provider's panel (e.g. by loading the provider row with the
 * user's RLS-scoped client). `apiUrl` is passed in from that authorized read so
 * we never re-fetch it here.
 */
export async function getProviderCredentials(
  providerId: string,
  apiUrl: string
): Promise<ProviderCredentials> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_provider_key", {
    p_provider: providerId,
    p_secret: providerKeySecret(),
  });
  if (error) throw new ProviderError(`Could not read provider key: ${error.message}`);
  if (!data) throw new ProviderError("Provider has no API key set");
  return { apiUrl, apiKey: data as string };
}

/** Store the encrypted api key for a provider (service-role-only RPC). */
export async function storeProviderKey(providerId: string, apiKey: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_provider_key", {
    p_provider: providerId,
    p_key: apiKey,
    p_secret: providerKeySecret(),
  });
  if (error) throw new ProviderError(`Could not store provider key: ${error.message}`);
}
