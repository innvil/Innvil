import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { getAdapter } from "./adapters";

/* =========================================================
   PLATFORM PAYMENTS runtime (server-only).
   Decrypts the super-admin's platform gateway credentials and handles the
   owner→Innvil top-up webhook (credits panels.settings.innvil_balance).
   Never import into client code. Mirrors the per-panel getGatewayContext.
   ========================================================= */

function parseSecrets(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Load a PLATFORM gateway's public config + DECRYPTED secrets (service-role only). */
export async function getPlatformGatewayContext(
  gateway: string
): Promise<{ config: Record<string, string>; secrets: Record<string, string> } | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("platform_payment_gateways")
    .select("id, gateway, status, config")
    .eq("gateway", gateway)
    .maybeSingle();
  if (!row) return null;

  const config: Record<string, string> = { ...((row.config as Record<string, string>) ?? {}) };
  const { data: key } = await admin.rpc("get_platform_gateway_key", {
    p_row: row.id,
    p_secret: providerKeySecret(),
  });
  const secrets = parseSecrets(key);
  return { config, secrets };
}

/**
 * Shared platform-webhook handler (owner→Innvil top-ups). Steps:
 *  1. adapter extracts OUR platform_deposit id from the body,
 *  2. load the deposit → decrypt the platform gateway secrets,
 *  3. adapter authoritatively verifies + reports paid,
 *  4. atomically claim pending→completed (idempotent) + credit the panel's Innvil balance.
 * Always answers 200 for handled/ignored so gateways stop retrying; 500 = retry.
 */
export async function handlePlatformWebhook(req: Request, gateway: string): Promise<Response> {
  const adapter = getAdapter(gateway);
  if (!adapter) return NextResponse.json({ ok: true }, { status: 200 });

  const raw = await req.text();
  const depositId = adapter.extractOrderId(raw, req.headers);
  if (!depositId) return NextResponse.json({ ok: true }, { status: 200 });

  const admin = createAdminClient();
  const { data: deposit } = await admin
    .from("platform_deposits")
    .select("id, panel_id, gateway, credit_amount, status")
    .eq("id", depositId)
    .maybeSingle();
  if (!deposit || deposit.gateway !== gateway) return NextResponse.json({ ok: true }, { status: 200 });
  if (deposit.status === "completed") return NextResponse.json({ ok: true }, { status: 200 });

  const ctx = await getPlatformGatewayContext(gateway);
  if (!ctx) return NextResponse.json({ ok: true }, { status: 200 });

  let paid = false;
  try {
    const r = await adapter.verifyWebhook({ raw, headers: req.headers, config: ctx.config, secrets: ctx.secrets });
    paid = r.paid;
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 }); // transient — retry
  }
  if (!paid) return NextResponse.json({ ok: true }, { status: 200 });

  // Claim the transition so only one webhook credits.
  const { data: claimed } = await admin
    .from("platform_deposits")
    .update({ status: "completed" })
    .eq("id", deposit.id)
    .eq("status", "pending")
    .select("id, panel_id, credit_amount")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ ok: true }, { status: 200 });

  const { data: newBalance, error } = await admin.rpc("credit_panel_innvil_balance", {
    p_panel: claimed.panel_id,
    p_amount: Number(claimed.credit_amount),
  });
  if (error) {
    await admin.from("platform_deposits").update({ status: "pending" }).eq("id", deposit.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // A top-up unsticks a panel that was auto-suspended for a drained Innvil balance.
  await reactivatePanelIfFunded(admin, claimed.panel_id, Number(newBalance));
  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * Reactivate a panel that the commission draw-down auto-moved to `inactive` for a
 * zero Innvil balance. Only touches panels we flagged (`innvil_suspended`) so an
 * owner's own `inactive`/`suspended` choice is never overridden.
 */
async function reactivatePanelIfFunded(
  admin: ReturnType<typeof createAdminClient>,
  panelId: string,
  balance: number
): Promise<void> {
  if (!(balance > 0)) return;
  const { data: panel } = await admin
    .from("panels")
    .select("status, settings")
    .eq("id", panelId)
    .maybeSingle();
  if (!panel) return;
  const settings = (panel.settings && typeof panel.settings === "object")
    ? (panel.settings as Record<string, unknown>)
    : {};
  if (settings.innvil_suspended !== true) return;

  const rest = { ...settings };
  delete rest.innvil_suspended;
  await admin
    .from("panels")
    .update({ status: panel.status === "inactive" ? "live" : panel.status, settings: rest })
    .eq("id", panelId);
}
