import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

type SnapshotPayload = {
  balance: number;
  deposits: unknown[];
  orders: unknown[];
  apiEnabled: boolean;
  apiHasKey: boolean;
  accountStatus: string;
  panelStatus: string;
  updatedAt: string;
};

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { panelId?: string };
    const panelId = body.panelId?.trim();
    if (!panelId) {
      return NextResponse.json({ ok: false, error: "panelId is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const userResp = await admin.auth.getUser(token);
    const user = userResp.data.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
    }

    const { data: acct } = await admin
      .from("customer_accounts")
      .select("id")
      .eq("panel_id", panelId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!acct) {
      return NextResponse.json({ ok: false, error: "No customer account" }, { status: 404 });
    }

    // Ensure the cache row exists and is fresh enough for this request.
    await admin.rpc("rebuild_storefront_snapshot", { p_customer: acct.id });

    const { data: snap } = await admin
      .from("storefront_customer_snapshots")
      .select("balance, deposits, orders, api_enabled, api_has_key, account_status, panel_status, updated_at")
      .eq("customer_id", acct.id)
      .maybeSingle();

    if (!snap) {
      return NextResponse.json({ ok: false, error: "Snapshot unavailable" }, { status: 500 });
    }

    const payload: SnapshotPayload = {
      balance: Number(snap.balance ?? 0),
      deposits: Array.isArray(snap.deposits) ? (snap.deposits as unknown[]) : [],
      orders: Array.isArray(snap.orders) ? (snap.orders as unknown[]) : [],
      apiEnabled: snap.api_enabled !== false,
      apiHasKey: snap.api_has_key === true,
      accountStatus: String(snap.account_status ?? "active"),
      panelStatus: String(snap.panel_status ?? "draft"),
      updatedAt: String(snap.updated_at ?? new Date().toISOString()),
    };

    return NextResponse.json({ ok: true, snapshot: payload }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Snapshot fetch failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
