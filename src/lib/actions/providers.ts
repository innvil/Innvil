"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getProviderCredentials,
  storeProviderKey,
  getBalance,
  fetchServices,
  ProviderError,
} from "@/src/lib/providers";
import { validateProviderApiBaseUrl } from "@/src/lib/providers/url-validation";
import type { ProviderRow, ProviderStatus } from "@/src/types/db";
import { round4 } from "@/src/lib/money";

// Ignore sub-cent balance jitter; anything above is treated as a real increase.
const TOPUP_FLOOR = 0.01;

type Result<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

export interface ProviderInput {
  panelId: string;
  name: string;
  apiUrl: string;
  apiKey?: string;
  status?: ProviderStatus;
  currency?: string;
  notes?: string;
}

// Every non-secret column. NEVER select `*` on providers — the encrypted
// api_key_enc column is revoked from clients and `*` would try to read it.
const PROVIDER_COLS =
  "id, panel_id, name, api_url, status, balance, currency, last_balance_sync, notes, created_at, updated_at";

/** Code-enforced authz: does this user own the panel? (Uses the admin client.) */
async function ownsPanel(
  admin: SupabaseClient,
  userId: string,
  panelId: string
): Promise<boolean> {
  const { data } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

/**
 * Load a provider only if the current user owns its panel. Returns null otherwise
 * — that ownership check IS the authorization gate before any key operation.
 */
async function loadAuthorizedProvider(
  admin: SupabaseClient,
  userId: string,
  providerId: string
): Promise<ProviderRow | null> {
  const { data } = await admin
    .from("providers")
    .select(PROVIDER_COLS)
    .eq("id", providerId)
    .maybeSingle();
  const provider = (data as ProviderRow) ?? null;
  if (!provider) return null;
  if (!(await ownsPanel(admin, userId, provider.panel_id))) return null;
  return provider;
}

/** Providers for a panel the user owns (no keys). Empty when signed out / not owned. */
export async function listProviders(panelId: string): Promise<ProviderRow[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  if (!(await ownsPanel(admin, user.id, panelId))) return [];
  const { data } = await admin
    .from("providers")
    .select(PROVIDER_COLS)
    .eq("panel_id", panelId)
    .order("created_at", { ascending: true });
  return (data as ProviderRow[]) ?? [];
}

export interface OwnerProviderVM extends ProviderRow {
  panelName: string;
}

/** Every provider across ALL panels the owner controls (no keys). For the app-level
 *  Providers page — one place to see which API needs a top-up. */
export async function listAllOwnerProviders(): Promise<OwnerProviderVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data: panels } = await admin.from("panels").select("id, name").eq("owner_id", user.id);
  const list = (panels as Array<{ id: string; name: string }> | null) ?? [];
  if (!list.length) return [];
  const nameById = new Map(list.map((p) => [p.id, p.name]));
  const { data } = await admin
    .from("providers")
    .select(PROVIDER_COLS)
    .in("panel_id", list.map((p) => p.id))
    .order("created_at", { ascending: true });
  return ((data as ProviderRow[] | null) ?? []).map((p) => ({ ...p, panelName: nameById.get(p.panel_id) ?? "Panel" }));
}

export async function createProvider(input: ProviderInput): Promise<Result<{ id: string }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(admin, user.id, input.panelId)))
    return { ok: false, error: "Not authorized for this panel" };

  const apiUrlCheck = validateProviderApiBaseUrl(input.apiUrl, {
    requireHttps: process.env.NODE_ENV === "production",
  });
  if (!apiUrlCheck.ok) return { ok: false, error: apiUrlCheck.error };

  const { data, error } = await admin
    .from("providers")
    .insert({
      panel_id: input.panelId,
      name: input.name,
      api_url: apiUrlCheck.value,
      status: input.status ?? "active",
      currency: input.currency ?? "USD",
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (input.apiKey) {
    try {
      await storeProviderKey(data.id, input.apiKey);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to store key" };
    }
  }
  return { ok: true, data: { id: data.id } };
}

export async function updateProvider(
  providerId: string,
  patch: Partial<Omit<ProviderInput, "panelId">>
): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const existing = await loadAuthorizedProvider(admin, user.id, providerId);
  if (!existing) return { ok: false, error: "Provider not found" };

  let nextApiUrl: string | undefined;
  if (patch.apiUrl !== undefined) {
    const apiUrlCheck = validateProviderApiBaseUrl(patch.apiUrl, {
      requireHttps: process.env.NODE_ENV === "production",
    });
    if (!apiUrlCheck.ok) return { ok: false, error: apiUrlCheck.error };
    nextApiUrl = apiUrlCheck.value;
  }

  const { error } = await admin
    .from("providers")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(nextApiUrl !== undefined && { api_url: nextApiUrl }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.currency !== undefined && { currency: patch.currency }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
    })
    .eq("id", providerId);
  if (error) return { ok: false, error: error.message };

  if (patch.apiKey) {
    try {
      await storeProviderKey(providerId, patch.apiKey);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to store key" };
    }
  }
  return { ok: true };
}

export async function deleteProvider(providerId: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const existing = await loadAuthorizedProvider(admin, user.id, providerId);
  if (!existing) return { ok: false, error: "Provider not found" };
  const { error } = await admin.from("providers").delete().eq("id", providerId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Test a provider's credentials by fetching its balance. Never returns the key. */
export async function testProviderConnection(
  providerId: string
): Promise<Result<{ balance: string; currency: string }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const provider = await loadAuthorizedProvider(admin, user.id, providerId);
  if (!provider) return { ok: false, error: "Provider not found" };

  try {
    const creds = await getProviderCredentials(providerId, provider.api_url);
    const balance = await getBalance(creds);
    if ("error" in balance) return { ok: false, error: balance.error };
    return { ok: true, data: { balance: balance.balance, currency: balance.currency } };
  } catch (e) {
    const msg =
      e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Connection failed";
    return { ok: false, error: msg };
  }
}

/** Fetch the provider balance and cache it on the row (balance + last_balance_sync). */
export async function fetchProviderBalance(
  providerId: string
): Promise<Result<{ balance: string; currency: string }>> {
  const test = await testProviderConnection(providerId); // also enforces ownership
  if (!test.ok) return test;

  const { user, admin } = await getAuthedAdmin();
  const newBal = Number(test.data.balance);
  const newCur = (test.data.currency || "USD").toUpperCase();

  // Read the prior snapshot to detect a top-up: a balance INCREASE since the last
  // sync means the owner funded the provider. We only track increases AFTER the
  // first observation, so whatever they held before using Innvil is the baseline
  // (never counted) — the record is purely Innvil's internal spend tracker.
  const { data: prev } = await admin
    .from("providers")
    .select("balance, currency, last_balance_sync, name, pending_refund_credit")
    .eq("id", providerId)
    .maybeSingle();

  if (
    user &&
    prev?.last_balance_sync &&
    prev.balance != null &&
    (prev.currency || "USD").toUpperCase() === newCur
  ) {
    const delta = round4(newBal - Number(prev.balance));
    if (delta > TOPUP_FLOOR) {
      // Option A: net out provider-side refunds we already know about (the sync queues
      // them in pending_refund_credit) so a refund landing on the balance isn't logged
      // as a top-up. Any leftover is a real top-up; flag it for review if it overlapped
      // a refund (so the owner can confirm it isn't a refund we mis-estimated).
      const pending = Math.max(Number(prev.pending_refund_credit ?? 0), 0);
      const consumed = round4(Math.min(delta, pending));
      const netTopup = round4(delta - consumed);
      if (consumed > 0) {
        await admin.rpc("bump_provider_refund_credit", { p_provider: providerId, p_amount: -consumed });
      }
      if (netTopup > TOPUP_FLOOR) {
        await admin.from("provider_topups").insert({
          owner_id: user.id,
          provider_id: providerId,
          provider_name: prev.name ?? "Provider",
          amount: netTopup,
          currency: newCur,
          note: consumed > 0 ? "Auto-detected — verify vs refund" : "Auto-detected top-up",
          kind: "topup",
          needs_review: consumed > 0,
          topped_up_at: new Date().toISOString(),
        });
      }
    }
  }

  await admin
    .from("providers")
    .update({ balance: newBal, currency: newCur, last_balance_sync: new Date().toISOString() })
    .eq("id", providerId);
  return test;
}

/**
 * Refresh EVERY provider balance across the owner's panels in ONE request, in
 * parallel server-side. Much faster than N separate `fetchProviderBalance` server
 * actions (Next serializes actions from a single client, so those run one-by-one).
 */
export async function refreshAllProviderBalances(): Promise<
  { ok: true; refreshed: number; total: number } | { ok: false; error: string }
> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: panels } = await admin.from("panels").select("id").eq("owner_id", user.id);
  const panelIds = ((panels as Array<{ id: string }> | null) ?? []).map((p) => p.id);
  if (!panelIds.length) return { ok: true, refreshed: 0, total: 0 };

  const { data: provs } = await admin.from("providers").select("id").in("panel_id", panelIds);
  const ids = ((provs as Array<{ id: string }> | null) ?? []).map((p) => p.id);
  if (!ids.length) return { ok: true, refreshed: 0, total: 0 };

  const results = await Promise.all(ids.map((id) => fetchProviderBalance(id).catch(() => null)));
  return { ok: true, refreshed: results.filter((r) => r && r.ok).length, total: ids.length };
}

/** Quick reachability check that also confirms the service list parses. */
export async function countProviderServices(
  providerId: string
): Promise<Result<{ count: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const provider = await loadAuthorizedProvider(admin, user.id, providerId);
  if (!provider) return { ok: false, error: "Provider not found" };
  try {
    const creds = await getProviderCredentials(providerId, provider.api_url);
    const services = await fetchServices(creds);
    return { ok: true, data: { count: services.length } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to fetch services" };
  }
}
