import { createAdminClient } from "@/src/lib/supabase/admin";
import { getGatewayContext } from "@/src/lib/payments";
import { diagnosePayTransactions } from "@/src/lib/payments/binance";

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function resolvePanelId(): Promise<string> {
  const explicit = parseArg("panel");
  if (explicit) return explicit;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("panel_payment_gateways")
    .select("panel_id")
    .eq("gateway", "binance_pay")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not query panel_payment_gateways: ${error.message}`);
  if (!data?.panel_id) throw new Error("No active binance_pay gateway row found. Pass --panel=<panel-id>.");
  return String(data.panel_id);
}

function likelyCause(code: string | null, message: string | null): string[] {
  const msg = String(message ?? "").toLowerCase();
  const causes: string[] = [];

  if (code === "BINANCE_INVALID_API_KEY") causes.push("Likely cause #1/#2/#3/#8/#9: wrong key/secret, merchant-portal credential, missing permission, testnet key, or accidental formatting.");
  if (code === "BINANCE_INVALID_SIGNATURE") causes.push("Likely cause #5/#9: signature mismatch from encoding/order/secret formatting issues.");
  if (code === "BINANCE_TIMESTAMP_OUTSIDE_WINDOW") causes.push("Likely cause #6: timestamp outside recvWindow due to time skew or delay.");
  if (code === "BINANCE_IP_RESTRICTED") causes.push("Likely cause #4/#7: API key IP restrictions rejecting this host/region outbound IP.");
  if (code === "BINANCE_PERMISSION_DENIED") causes.push("Likely cause #3: API key lacks required signed USER_DATA/SAPI permissions.");
  if (code === "BINANCE_RATE_LIMITED") causes.push("Likely cause #10 with throttling: rate limit exceeded.");
  if (code === "BINANCE_NETWORK_ERROR") causes.push("Likely cause #7: network/DNS/TLS/region path issue from execution environment.");
  if (code === "BINANCE_NON_JSON_RESPONSE") causes.push("Likely cause #10: non-JSON upstream response or proxy edge response.");

  if (!causes.length && /invalid api[- ]?key|signature|timestamp|ip|permission|too many requests/.test(msg)) {
    causes.push("Likely cause inferred from Binance message content; inspect code/message pair.");
  }
  if (!causes.length) causes.push("No single dominant cause inferred; inspect diagnostics fields and Binance code/message.");
  return causes;
}

async function main() {
  const panelId = await resolvePanelId();
  const ctx = await getGatewayContext(panelId, "binance_pay");
  if (!ctx?.secrets.apiKey || !ctx.secrets.apiSecret) {
    throw new Error(`Panel ${panelId} has incomplete Binance credentials.`);
  }

  const now = Date.now();
  const startTime = now - 30 * 60 * 1000;
  const endTime = now;

  const out = await diagnosePayTransactions(
    { apiKey: ctx.secrets.apiKey, apiSecret: ctx.secrets.apiSecret },
    { startTime, endTime, limit: 100 }
  );

  const result = {
    panelId,
    window: { startTime, endTime },
    ok: out.ok,
    diagnostics: out.diagnostics,
    error: out.ok ? null : out.error,
    likelyCauses: out.ok ? ["No Binance error; request succeeded."] : likelyCause(out.error.code, out.error.binanceMessage ?? out.error.message),
    outboundIpAllowedInference: out.ok
      ? "Likely allowed for this request"
      : out.error.code === "BINANCE_IP_RESTRICTED"
        ? "Not allowed (inferred from Binance response)"
        : "Unknown (Binance does not expose key allowlist directly)",
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("BINANCE_DIAG_FATAL", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
