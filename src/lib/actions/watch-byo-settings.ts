"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { resolveAccountEnterpriseEntitlement, resolveAccountWatchTier } from "@/src/lib/products/watch-runtime";
import {
  hasByoCredential, getAccountByoCredential, setAccountByoCredential, clearAccountByoCredential, type WatchByoProvider,
} from "@/src/lib/products/watch-byo";
import { getByoProviderHealth, type ByoProviderHealth } from "@/src/lib/products/watch-byo-usage";

/**
 * Self-serve BYO credential management -- originally BYO Enterprise-only
 * (Phase 2, 2026-08-24), widened 2026-08-25 to also cover the self-serve
 * BYO 20 tier (which is BYO by tier definition, no Managed/BYO choice).
 * Reuses watch-byo.ts's existing storage functions verbatim for BOTH paths
 * -- no second credential-storage mechanism. Every export is gated server-
 * side on the SIGNED-IN account's OWN real entitlement (Enterprise with
 * apiSourceMode === "byo", OR tier === "byo20") -- never trusts a client-
 * supplied account id, and never a UI-only gate (a direct call from a
 * non-BYO account is rejected here regardless of what any client shows).
 *
 * Enterprise itself remains entirely manual/devops-provisioned (no self-
 * serve PURCHASE flow exists for Enterprise anywhere in this codebase) --
 * this lets an ALREADY-provisioned BYO Enterprise account, or a self-serve
 * byo20 subscriber, manage its OWN credential without emailing support
 * every time it needs to set/rotate a key.
 */

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface WatchByoCredentialState {
  hasCredential: boolean;
  provider: WatchByoProvider | null;
  baseUrl: string | null;
  model: string | null;
}

async function requireByoAccount(): Promise<{ ok: true; admin: Awaited<ReturnType<typeof getAuthedAdmin>>["admin"]; accountId: string } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const enterprise = await resolveAccountEnterpriseEntitlement(admin, user.id);
  if (enterprise?.apiSourceMode === "byo") return { ok: true, admin, accountId: user.id };
  const tier = await resolveAccountWatchTier(admin, user.id);
  if (tier === "byo20") return { ok: true, admin, accountId: user.id };
  return { ok: false, error: "This account isn't provisioned for a BYO plan." };
}

/** Never returns the decrypted API key -- only its presence/provider/base
 *  URL/model, mirroring how the devops read action never returns a stored
 *  secret either. */
export async function getWatchByoCredentialState(): Promise<Result<WatchByoCredentialState>> {
  const ctx = await requireByoAccount();
  if (!ctx.ok) return ctx;
  const cred = await getAccountByoCredential(ctx.admin, ctx.accountId);
  return {
    ok: true,
    data: { hasCredential: cred != null, provider: cred?.provider ?? null, baseUrl: cred?.baseUrl ?? null, model: cred?.model ?? null },
  };
}

export async function setWatchByoCredential(provider: WatchByoProvider, apiKey: string, baseUrl?: string, model?: string): Promise<Result> {
  const ctx = await requireByoAccount();
  if (!ctx.ok) return ctx;
  if (!apiKey.trim()) return { ok: false, error: "Enter an API key." };
  await setAccountByoCredential(ctx.admin, ctx.accountId, { provider, apiKey: apiKey.trim(), baseUrl: baseUrl?.trim() || null, model: model?.trim() || null });
  return { ok: true, data: null };
}

export async function clearWatchByoCredential(): Promise<Result> {
  const ctx = await requireByoAccount();
  if (!ctx.ok) return ctx;
  await clearAccountByoCredential(ctx.admin, ctx.accountId);
  return { ok: true, data: null };
}

/** Provider health/observability (Phase 4.V.1) -- "is my provider actually
 *  working?" Real last-success/last-error/recent-volume, built entirely
 *  from already-recorded telemetry (watch-byo-usage.ts's
 *  getByoProviderHealth) -- never fabricates a status. */
export async function getWatchByoProviderHealth(): Promise<Result<ByoProviderHealth>> {
  const ctx = await requireByoAccount();
  if (!ctx.ok) return ctx;
  const health = await getByoProviderHealth(ctx.admin, ctx.accountId);
  return { ok: true, data: health };
}

/** Cheap existence-only check, for gating the Settings tab's visibility
 *  without fetching the fuller state. Kept separate from
 *  getWatchByoCredentialState so app/settings/page.tsx's own already-
 *  fetched AccountCapacity.hasByoCredential can be used directly there
 *  instead -- this export exists for any future caller that only has the
 *  authenticated session, not an already-resolved AccountCapacity. */
export async function hasWatchByoCredentialConfigured(): Promise<boolean> {
  const ctx = await requireByoAccount();
  if (!ctx.ok) return false;
  return hasByoCredential(ctx.admin, ctx.accountId);
}
