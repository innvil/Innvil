import "server-only";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";

export * from "./cryptomus"; // low-level Cryptomus client (used by its adapter)
export * from "./adapters"; // adapter registry + catalog + types

/** Non-secret columns of a panel's gateway row. */
export const GATEWAY_COLS = "id, panel_id, gateway, status, config, merchant_id";

function parseSecrets(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {}; // legacy bare-string handled by the caller (cryptomus back-compat)
  }
}

/**
 * Load a panel's gateway public config + DECRYPTED secrets (service-role only).
 * Secrets live as an encrypted JSON blob in `api_key_enc`. NEVER return to client.
 */
export async function getGatewayContext(
  panelId: string,
  gateway: string
): Promise<{ config: Record<string, string>; secrets: Record<string, string> } | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("panel_payment_gateways")
    .select(GATEWAY_COLS)
    .eq("panel_id", panelId)
    .eq("gateway", gateway)
    .maybeSingle();
  if (!row) return null;

  const config: Record<string, string> = { ...((row.config as Record<string, string>) ?? {}) };
  // Back-compat: Cryptomus originally stored merchantId in the merchant_id column.
  if (gateway === "cryptomus" && row.merchant_id && !config.merchantId) {
    config.merchantId = row.merchant_id as string;
  }

  const { data: key } = await admin.rpc("get_gateway_key", {
    p_row: row.id,
    p_secret: providerKeySecret(),
  });
  let secrets = parseSecrets(key);
  // Back-compat: Cryptomus originally stored the bare apiKey string (not JSON).
  if (gateway === "cryptomus" && Object.keys(secrets).length === 0 && typeof key === "string" && key) {
    secrets = { apiKey: key };
  }
  return { config, secrets };
}
