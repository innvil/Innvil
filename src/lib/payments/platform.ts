import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { getAdapter } from "./adapters";
import { activateWatchEntitlement } from "@/src/lib/products/ownership";
import { creditInnvilCreditTopUp } from "@/src/lib/products/innvil-credit";
import { getAccountPaidPlan } from "@/src/lib/products/watch-runtime";
import { getCommunityExpansionState, finalizeAddonsOnRenewal, finalizeAddonsOnTierChange } from "@/src/lib/products/watch-community-expansion";

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
    .select("id, panel_id, gateway, credit_amount, status, purpose, owner_id, plan")
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

  // Claim the transition so only one webhook credits/activates -- the SAME
  // single conditional UPDATE covers BOTH purposes, so a duplicate/retried
  // webhook can never double-credit a panel top-up OR double-activate a
  // direct Watch entitlement.
  const { data: claimed } = await admin
    .from("platform_deposits")
    .update({ status: "completed" })
    .eq("id", deposit.id)
    .eq("status", "pending")
    .select("id, panel_id, credit_amount, purpose, owner_id, plan")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ ok: true }, { status: 200 });

  if (claimed.purpose === "watch_subscription") {
    // Resolve the tier BEFORE activation overwrites it -- needed to detect a
    // genuine plan CHANGE (see watch-community-expansion.ts's
    // finalizeAddonsOnTierChange doc comment: a plan change never carries
    // Community Expansion across tiers). createDirectWatchCheckout already
    // blocked creating this checkout if it would leave the account over the
    // new tier's included capacity -- this just completes the finalization.
    const priorPlan = await getAccountPaidPlan(admin, claimed.owner_id as string);
    const isTierChange = priorPlan != null && priorPlan.tier !== claimed.plan;
    const hadExpansion = isTierChange ? await getCommunityExpansionState(admin, claimed.owner_id as string) : null;

    await activateWatchEntitlement(admin, claimed.owner_id as string, claimed.plan as string, claimed.id as string);
    // Finalizes (marks 'removed') a Community Expansion scheduled for
    // removal -- a real no-op unless one is actually pending, safe to call
    // after every base-subscription settlement (initial purchase or renewal).
    await finalizeAddonsOnRenewal(admin, claimed.owner_id as string);
    if (isTierChange && hadExpansion) await finalizeAddonsOnTierChange(admin, claimed.owner_id as string);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (claimed.purpose === "innvil_credit_topup") {
    await creditInnvilCreditTopUp(admin, claimed.owner_id as string, Math.round(Number(claimed.credit_amount) * 100), claimed.id as string);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (claimed.purpose === "watch_addon_purchase") {
    // Standalone direct-crypto Community Expansion purchase -- activates
    // the add-on itself (never touches the base subscription's own
    // period). A duplicate/retried webhook can never double-activate:
    // this branch only ever runs once per deposit (the SAME pending->
    // completed claim above already guarantees that), and the add-on
    // table's own partial unique index (account_id, addon_type) where
    // status='active' rejects a genuinely concurrent duplicate insert.
    const { error: insertError } = await admin
      .from("watch_subscription_addons")
      .insert({ account_id: claimed.owner_id as string, addon_type: "community_expansion", status: "active" });
    if (insertError && insertError.code !== "23505") {
      console.error("[platform-webhook] Community Expansion activation failed", { accountId: claimed.owner_id, depositId: claimed.id, error: insertError.message });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

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
  const nextStatus = panel.status === "inactive" ? "live" : panel.status;
  await admin.from("panels").update({ status: nextStatus, settings: rest }).eq("id", panelId);
  if (nextStatus !== panel.status) {
    await admin.from("audit_logs").insert({
      panel_id: panelId,
      action: "panel.status_changed",
      meta: { from: panel.status, to: nextStatus, by: "system", reason: "innvil_topup" },
    });
  }
}
