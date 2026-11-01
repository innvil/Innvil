"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { round4 } from "@/src/lib/money";

/* Owner-logged provider top-ups. The owner records each time they fund a provider
   account (done on the provider's own site); Innvil tracks the totals per period
   and exports them as an internal cost record. Owner-scoped via the service role. */

export interface ProviderTopup {
  id: string;
  providerId: string | null;
  providerName: string;
  amount: number;
  currency: string;
  note: string | null;
  toppedUpAt: string; // ISO
  kind: string; // 'topup' (counts) | 'refund' (excluded from totals)
  needsReview: boolean; // increase overlapped a known refund — owner should confirm
}

type Result = { ok: true } | { ok: false; error: string };

export async function logProviderTopup(input: {
  providerId: string;
  amount: number;
  currency?: string;
  note?: string;
  toppedUpAt?: string; // ISO or yyyy-mm-dd
}): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const amount = round4(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter an amount greater than 0." };

  // Resolve the provider and confirm the owner controls its panel.
  const { data: prov } = await admin
    .from("providers")
    .select("id, name, currency, panel_id")
    .eq("id", input.providerId)
    .maybeSingle();
  if (!prov) return { ok: false, error: "Provider not found." };
  const { data: panel } = await admin.from("panels").select("owner_id").eq("id", prov.panel_id).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return { ok: false, error: "Not authorized for that provider." };

  const currency = (input.currency || prov.currency || "USD").toUpperCase().slice(0, 8);
  let toppedUpAt = new Date().toISOString();
  if (input.toppedUpAt) {
    const d = new Date(input.toppedUpAt);
    if (!Number.isNaN(d.getTime())) toppedUpAt = d.toISOString();
  }

  const { error } = await admin.from("provider_topups").insert({
    owner_id: user.id,
    provider_id: prov.id,
    provider_name: prov.name,
    amount,
    currency,
    note: (input.note ?? "").trim().slice(0, 200) || null,
    topped_up_at: toppedUpAt,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listProviderTopups(limit = 500): Promise<ProviderTopup[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data } = await admin
    .from("provider_topups")
    .select("id, provider_id, provider_name, amount, currency, note, topped_up_at, kind, needs_review")
    .eq("owner_id", user.id)
    .order("topped_up_at", { ascending: false })
    .limit(limit);
  return ((data as Array<{ id: string; provider_id: string | null; provider_name: string; amount: number; currency: string; note: string | null; topped_up_at: string; kind: string | null; needs_review: boolean | null }> | null) ?? [])
    .map((r) => ({
      id: r.id,
      providerId: r.provider_id,
      providerName: r.provider_name,
      amount: Number(r.amount),
      currency: r.currency,
      note: r.note,
      toppedUpAt: r.topped_up_at,
      kind: r.kind ?? "topup",
      needsReview: r.needs_review ?? false,
    }));
}

/** Classify a tracked entry (answers "is this a refund?") — refunds are excluded from totals. */
export async function setProviderTopupKind(id: string, kind: "topup" | "refund"): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (kind !== "topup" && kind !== "refund") return { ok: false, error: "Invalid type." };
  const { error } = await admin
    .from("provider_topups")
    .update({ kind, needs_review: false })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteProviderTopup(id: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const { error } = await admin.from("provider_topups").delete().eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
