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
import type { ProviderRow, ProviderStatus } from "@/src/types/db";

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

  const { data, error } = await admin
    .from("providers")
    .insert({
      panel_id: input.panelId,
      name: input.name,
      api_url: input.apiUrl,
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

  const { error } = await admin
    .from("providers")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.apiUrl !== undefined && { api_url: patch.apiUrl }),
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
  const test = await testProviderConnection(providerId);
  if (!test.ok) return test;

  const { admin } = await getAuthedAdmin();
  await admin
    .from("providers")
    .update({
      balance: Number(test.data.balance),
      currency: test.data.currency,
      last_balance_sync: new Date().toISOString(),
    })
    .eq("id", providerId);
  return test;
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
