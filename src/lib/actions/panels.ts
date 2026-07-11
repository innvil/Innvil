"use server";

import { getAuthedAdmin, ensureProfile } from "@/src/lib/auth";
import type { Panel } from "@/src/types";
import type { PanelRow, PanelStatus } from "@/src/types/db";

/** Map a DB panel row to the view-model shape the admin UI already uses. */
function toPanel(row: PanelRow): Panel {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    domain: row.custom_domain,
    status: row.status,
    ordersToday: 0, // TODO: aggregate from orders once §4/§9 land
    theme: row.theme ?? "—",
  };
}

/** Panels the signed-in user owns. Empty when signed out. */
export async function listPanels(): Promise<Panel[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  // Authz enforced in code: only this user's panels. (Staff/panel_members
  // access can be unioned in here once the staff feature lands — §10.)
  const { data } = await admin
    .from("panels")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });
  return ((data as PanelRow[]) ?? []).map(toPanel);
}

export type CreatePanelResult =
  | { ok: true; panel: Panel }
  | { ok: false; error: string };

export async function createPanel(input: {
  name: string;
  subdomain: string;
  theme?: string;
}): Promise<CreatePanelResult> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const name = input.name.trim();
  const subdomain = input.subdomain.trim().toLowerCase();
  if (!name) return { ok: false, error: "Panel name is required" };
  if (!/^[a-z0-9-]{3,}$/.test(subdomain))
    return { ok: false, error: "Subdomain must be 3+ chars (a–z, 0–9, hyphen)" };

  // A panel owner must have a profile row (FK target); ensure it exists.
  await ensureProfile(user.id, "panel_owner");

  const { data, error } = await admin
    .from("panels")
    .insert({
      owner_id: user.id, // forced to the authenticated user — cannot be spoofed
      name,
      subdomain,
      status: "draft",
      theme: input.theme ?? null,
    })
    .select("*")
    .single();

  if (error) {
    const taken = error.code === "23505" || /duplicate|unique/i.test(error.message);
    return { ok: false, error: taken ? "That subdomain is already taken" : error.message };
  }
  return { ok: true, panel: toPanel(data as PanelRow) };
}

export async function updatePanelStatus(
  panelId: string,
  status: PanelStatus
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  // Verify ownership before mutating (admin client bypasses RLS).
  const { data: owned } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!owned) return { ok: false, error: "Panel not found" };

  const { error } = await admin.from("panels").update({ status }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
