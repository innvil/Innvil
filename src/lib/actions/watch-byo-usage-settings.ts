"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { resolveAccountEnterpriseEntitlement } from "@/src/lib/products/watch-runtime";
import {
  listByoUsagePolicies, setByoUsagePolicy, clearByoUsagePolicy, getByoUsageStatus,
  type WatchByoUsagePolicy, type UsagePolicyPeriod, type UsagePolicyKind, type UsagePolicyScope,
} from "@/src/lib/products/watch-byo-usage-policy";

/**
 * BYO Enterprise usage POLICY -- customer-owned, self-configured operational
 * ceilings (Phase 4.V, extended in 4.V.1 with a reactive/proactive kind
 * split and a real 3-level account/Community/deployment hierarchy), on top
 * of the already-provisioned BYO credential. Same gating discipline as
 * watch-byo-settings.ts (credential management): every export re-verifies
 * the SIGNED-IN account's own real `apiSourceMode === "byo"` entitlement
 * server-side -- never trusts a client-supplied account id or a UI-only gate.
 */

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function requireByoEnterprise(): Promise<{ ok: true; admin: Awaited<ReturnType<typeof getAuthedAdmin>>["admin"]; accountId: string } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const enterprise = await resolveAccountEnterpriseEntitlement(admin, user.id);
  if (!enterprise || enterprise.apiSourceMode !== "byo") return { ok: false, error: "This account isn't provisioned for BYO Enterprise." };
  return { ok: true, admin, accountId: user.id };
}

export interface ByoUsagePolicyStatus extends WatchByoUsagePolicy {
  used: number;
  usedTokens: number;
}

export async function getByoUsagePolicyStatus(): Promise<Result<ByoUsagePolicyStatus[]>> {
  const ctx = await requireByoEnterprise();
  if (!ctx.ok) return ctx;
  const rows = await getByoUsageStatus(ctx.admin, ctx.accountId);
  return { ok: true, data: rows };
}

/** `tokenLimit` follows setByoUsagePolicy's own omit/null/number semantics
 *  exactly: omitted -> leave any existing token limit untouched; explicit
 *  null -> clear it; a positive number -> set it. */
export async function saveByoUsagePolicy(scope: UsagePolicyScope, kind: UsagePolicyKind, period: UsagePolicyPeriod, requestLimit: number, tokenLimit?: number | null): Promise<Result> {
  const ctx = await requireByoEnterprise();
  if (!ctx.ok) return ctx;
  const res = await setByoUsagePolicy(ctx.admin, ctx.accountId, scope, kind, period, requestLimit, tokenLimit);
  if (!res.ok) return res;
  return { ok: true, data: null };
}

export async function removeByoUsagePolicy(scope: UsagePolicyScope, kind: UsagePolicyKind): Promise<Result> {
  const ctx = await requireByoEnterprise();
  if (!ctx.ok) return ctx;
  await clearByoUsagePolicy(ctx.admin, ctx.accountId, scope, kind);
  return { ok: true, data: null };
}

/** Cheap listing, no `used` counts -- for a lighter-weight caller that only
 *  needs to know what's configured (not current usage). */
export async function getByoUsagePolicies(): Promise<Result<WatchByoUsagePolicy[]>> {
  const ctx = await requireByoEnterprise();
  if (!ctx.ok) return ctx;
  const rows = await listByoUsagePolicies(ctx.admin, ctx.accountId);
  return { ok: true, data: rows };
}
