import "server-only";

import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";

export type BinanceCredentialErrorCode =
  | "BINANCE_NOT_CONFIGURED"
  | "BINANCE_INACTIVE"
  | "BINANCE_DECRYPT_FAILED"
  | "BINANCE_SECRET_MISSING";

export type BinanceCredentialResult =
  | {
      ok: true;
      rowId: string;
      config: Record<string, string>;
      secrets: { apiKey: string; apiSecret: string };
    }
  | {
      ok: false;
      code: "BINANCE_NOT_CONFIGURED";
      reason: BinanceCredentialErrorCode;
    };

interface GatewayRow {
  id: string;
  config: Record<string, unknown> | null;
}

interface LoaderDeps {
  getActiveGatewayRow: (panelId: string) => Promise<GatewayRow | null>;
  decryptGatewaySecrets: (rowId: string) => Promise<{ data: unknown; error: unknown }>;
  logError: (eventCode: string, panelId: string, rowId?: string | null) => void;
}

function maskId(value: string | null | undefined): string {
  if (!value) return "n/a";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function asStringMap(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function toStringConfig(raw: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function defaultDeps(): LoaderDeps {
  const admin = createAdminClient();
  return {
    getActiveGatewayRow: async (panelId: string) => {
      const { data } = await admin
        .from("panel_payment_gateways")
        .select("id, config")
        .eq("panel_id", panelId)
        .eq("gateway", "binance_pay")
        .eq("status", "active")
        .maybeSingle();
      if (!data?.id) return null;
      return {
        id: String(data.id),
        config: (data.config as Record<string, unknown> | null) ?? null,
      };
    },
    decryptGatewaySecrets: async (rowId: string) => {
      const out = await admin.rpc("get_gateway_key", {
        p_row: rowId,
        p_secret: providerKeySecret(),
      });
      return { data: out.data, error: out.error };
    },
    logError: (eventCode: string, panelId: string, rowId?: string | null) => {
      console.error("[binance-credentials]", {
        eventCode,
        panelId: maskId(panelId),
        rowId: maskId(rowId ?? null),
      });
    },
  };
}

export async function loadActiveBinanceCredentials(
  panelId: string,
  deps?: Partial<LoaderDeps>
): Promise<BinanceCredentialResult> {
  const fallback = (!deps?.getActiveGatewayRow || !deps?.decryptGatewaySecrets || !deps?.logError)
    ? defaultDeps()
    : null;
  const d: LoaderDeps = {
    getActiveGatewayRow: deps?.getActiveGatewayRow ?? (fallback as LoaderDeps).getActiveGatewayRow,
    decryptGatewaySecrets: deps?.decryptGatewaySecrets ?? (fallback as LoaderDeps).decryptGatewaySecrets,
    logError: deps?.logError ?? (fallback as LoaderDeps).logError,
  };

  const row = await d.getActiveGatewayRow(panelId);
  if (!row) {
    d.logError("BINANCE_NOT_CONFIGURED_ROW", panelId, null);
    return { ok: false, code: "BINANCE_NOT_CONFIGURED", reason: "BINANCE_NOT_CONFIGURED" };
  }

  const decrypted = await d.decryptGatewaySecrets(row.id);
  if (decrypted.error) {
    d.logError("BINANCE_DECRYPT_FAILED", panelId, row.id);
    return { ok: false, code: "BINANCE_NOT_CONFIGURED", reason: "BINANCE_DECRYPT_FAILED" };
  }

  const secrets = asStringMap(decrypted.data);
  const apiKey = (secrets.apiKey ?? "").trim();
  const apiSecret = (secrets.apiSecret ?? "").trim();

  if (!apiKey || !apiSecret) {
    d.logError("BINANCE_SECRET_MISSING", panelId, row.id);
    return { ok: false, code: "BINANCE_NOT_CONFIGURED", reason: "BINANCE_SECRET_MISSING" };
  }

  return {
    ok: true,
    rowId: row.id,
    config: toStringConfig(row.config),
    secrets: { apiKey, apiSecret },
  };
}
