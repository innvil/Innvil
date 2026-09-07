"use server";

import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient } from "@/src/lib/supabase/admin";

interface PanelSettingsApi {
  enabled: boolean;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  return `nb_live_${randomBytes(16).toString("hex")}`;
}

function apiSettings(settings: unknown): PanelSettingsApi {
  if (settings && typeof settings === "object") {
    const api = (settings as Record<string, unknown>).customerApi;
    if (api && typeof api === "object") {
      const o = api as Record<string, unknown>;
      return { enabled: o.enabled !== false };
    }
  }
  return { enabled: true };
}

async function ownsPanel(admin: SupabaseClient, userId: string, panelId: string): Promise<boolean> {
  const { data } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

async function currentCustomerAccount(panelId: string): Promise<{ id: string; api_key_hash: string | null; status: string } | null> {
  const supabase = await createStorefrontClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("customer_accounts")
    .select("id, api_key_hash, status")
    .eq("panel_id", panelId)
    .eq("user_id", user.id)
    .maybeSingle();

  return (data as { id: string; api_key_hash: string | null; status: string } | null) ?? null;
}

export async function getCustomerApiState(panelId: string): Promise<{
  ok: true;
  enabled: boolean;
  hasKey: boolean;
} | {
  ok: false;
  error: string;
}> {
  const acct = await currentCustomerAccount(panelId);
  if (!acct) return { ok: false, error: "No account found." };

  const admin = createAdminClient();
  const { data: panel } = await admin
    .from("panels")
    .select("settings")
    .eq("id", panelId)
    .maybeSingle();

  const enabled = apiSettings(panel?.settings).enabled;
  return { ok: true, enabled, hasKey: !!acct.api_key_hash };
}

export async function rotateCustomerApiKey(panelId: string): Promise<{
  ok: true;
  key: string;
} | {
  ok: false;
  error: string;
}> {
  const acct = await currentCustomerAccount(panelId);
  if (!acct) return { ok: false, error: "No account found." };
  if (acct.status !== "active") return { ok: false, error: "Your account cannot use API right now." };

  const key = generateApiKey();
  const hashed = hashApiKey(key);

  const admin = createAdminClient();
  const { error } = await admin
    .from("customer_accounts")
    .update({ api_key_hash: hashed })
    .eq("id", acct.id);
  if (error) return { ok: false, error: error.message };

  return { ok: true, key };
}

export interface PanelApiCustomerRow {
  id: string;
  username: string | null;
  email: string | null;
  status: string;
  hasKey: boolean;
  updatedAt: string;
}

export async function getPanelCustomerApiSummary(panelId: string): Promise<{
  ok: true;
  enabled: boolean;
  totalCustomers: number;
  activeKeys: number;
  rows: PanelApiCustomerRow[];
} | {
  ok: false;
  error: string;
}> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(admin, user.id, panelId))) return { ok: false, error: "Not authorized" };

  const [{ data: panel }, { data: rows }, { count: totalCustomers }, { count: activeKeys }] = await Promise.all([
    admin.from("panels").select("settings").eq("id", panelId).maybeSingle(),
    admin
      .from("customer_accounts")
      .select("id, user_id, status, api_key_hash, updated_at")
      .eq("panel_id", panelId)
      .order("updated_at", { ascending: false })
      .limit(50),
    admin.from("customer_accounts").select("id", { count: "exact", head: true }).eq("panel_id", panelId),
    admin.from("customer_accounts").select("id", { count: "exact", head: true }).eq("panel_id", panelId).not("api_key_hash", "is", null),
  ]);

  const enabled = apiSettings(panel?.settings).enabled;
  const list = (rows ?? []) as Array<{ id: string; user_id: string; status: string; api_key_hash: string | null; updated_at: string }>;

  const userIds = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const usernameByUserId = new Map<string, string | null>(
    (profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null])
  );

  return {
    ok: true,
    enabled,
    totalCustomers: totalCustomers ?? 0,
    activeKeys: activeKeys ?? 0,
    rows: list.map((r) => ({
      id: r.id,
      username: usernameByUserId.get(r.user_id) ?? null,
      email: null,
      status: r.status,
      hasKey: !!r.api_key_hash,
      updatedAt: r.updated_at,
    })),
  };
}

export async function setPanelCustomerApiEnabled(
  panelId: string,
  enabled: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(admin, user.id, panelId))) return { ok: false, error: "Not authorized" };

  const { data: panel } = await admin
    .from("panels")
    .select("settings")
    .eq("id", panelId)
    .maybeSingle();
  const settings = (panel?.settings && typeof panel.settings === "object")
    ? { ...(panel.settings as Record<string, unknown>) }
    : {};
  const prevApi = (settings.customerApi && typeof settings.customerApi === "object")
    ? (settings.customerApi as Record<string, unknown>)
    : {};
  settings.customerApi = { ...prevApi, enabled };

  const { error } = await admin
    .from("panels")
    .update({ settings })
    .eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function revokeCustomerApiKey(
  panelId: string,
  customerId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(admin, user.id, panelId))) return { ok: false, error: "Not authorized" };

  const { data: row } = await admin
    .from("customer_accounts")
    .select("id")
    .eq("id", customerId)
    .eq("panel_id", panelId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Customer not found" };

  const { error } = await admin
    .from("customer_accounts")
    .update({ api_key_hash: null })
    .eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
