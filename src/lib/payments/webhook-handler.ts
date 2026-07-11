import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAdapter, getGatewayContext } from "./index";

/* =========================================================
   Shared gateway webhook handler.
   Used by every /api/webhooks/<gateway> route. Steps:
     1. adapter extracts OUR payment id from the body (pre-verify),
     2. load the payment → its panel → decrypt that panel's gateway secrets,
     3. adapter authoritatively verifies + reports paid,
     4. atomically claim pending→completed (idempotent) + credit the wallet.
   Always answers 200 for handled/ignored so gateways stop retrying; 500 = retry.
   ========================================================= */

export async function handleGatewayWebhook(req: Request, gateway: string): Promise<Response> {
  const adapter = getAdapter(gateway);
  if (!adapter) return NextResponse.json({ ok: true }, { status: 200 });

  const raw = await req.text();
  const orderId = adapter.extractOrderId(raw, req.headers);
  if (!orderId) return NextResponse.json({ ok: true }, { status: 200 });

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, amount, status, gateway")
    .eq("id", orderId)
    .maybeSingle();
  if (!payment || payment.gateway !== gateway) return NextResponse.json({ ok: true }, { status: 200 });
  if (payment.status === "completed") return NextResponse.json({ ok: true }, { status: 200 });

  const ctx = await getGatewayContext(payment.panel_id as string, gateway);
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
    .from("payments")
    .update({ status: "completed" })
    .eq("id", payment.id)
    .eq("status", "pending")
    .select("id, customer_id, amount")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ ok: true }, { status: 200 });

  const { error } = await admin.rpc("apply_balance_change", {
    p_customer: claimed.customer_id,
    p_amount: Number(claimed.amount),
    p_type: "deposit",
    p_reason: `${gateway} deposit ${claimed.id}`,
  });
  if (error) {
    await admin.from("payments").update({ status: "pending" }).eq("id", payment.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
