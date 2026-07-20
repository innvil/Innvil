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

// Owners control these four themselves. `suspended` is Innvil-support-only (a
// trust/safety action), so an owner can never self-suspend or self-unsuspend.
const OWNER_SETTABLE: PanelStatus[] = ["draft", "live", "inactive", "maintenance"];

export async function updatePanelStatus(
  panelId: string,
  status: PanelStatus
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  if (!OWNER_SETTABLE.includes(status))
    return { ok: false, error: "That status can only be set by Innvil support." };

  // Verify ownership before mutating (admin client bypasses RLS).
  const { data: owned } = await admin
    .from("panels")
    .select("id, status, settings")
    .eq("id", panelId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!owned) return { ok: false, error: "Panel not found" };

  // A suspended panel is frozen until Innvil restores it — the owner can't flip it.
  if (owned.status === "suspended")
    return { ok: false, error: "This panel is suspended — contact Innvil support to restore it." };

  // Going live requires Innvil credit. If the billing loop paused this panel for a
  // drained balance, a top-up (not a status flip) is what brings it back.
  if (status === "live") {
    const settings = (owned.settings && typeof owned.settings === "object")
      ? (owned.settings as Record<string, unknown>)
      : {};
    const balance = Number(settings.innvil_balance ?? 0);
    if (settings.innvil_suspended === true && !(balance > 0))
      return { ok: false, error: "Top up your Innvil balance to bring this panel back live." };
  }

  const { error } = await admin.from("panels").update({ status }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Permanently delete a panel and everything under it (customers, orders, services,
 * providers, wallets, tickets, deposits — all cascade). Irreversible, so the caller
 * must echo back the panel's exact subdomain as a typed confirmation.
 */
export async function deletePanel(
  panelId: string,
  confirmation: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: owned } = await admin
    .from("panels")
    .select("id, subdomain")
    .eq("id", panelId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!owned) return { ok: false, error: "Panel not found" };

  if ((confirmation ?? "").trim().toLowerCase() !== owned.subdomain.toLowerCase())
    return { ok: false, error: `Type the panel's subdomain (${owned.subdomain}) to confirm deletion.` };

  const { error } = await admin.from("panels").delete().eq("id", panelId).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ---------------- Branding & Design Studio ---------------- */

/** An owner-authored promo/ad block shown on the storefront landing. */
export interface LandingSection {
  id: string;
  title: string;
  body: string;
  ctaLabel: string; // "" = no button
  ctaHref: string;
}

export interface PanelBranding {
  name: string;
  theme: string; // theme id
  logoUrl: string;
  accent: string; // custom accent hex ("" = use theme accent)
  headline: string; // storefront hero headline
  description: string; // storefront hero subtext
  favicon: string; // browser-tab icon URL ("" = use logo)
  sections: LandingSection[]; // extra owner-added landing blocks
}

type BrandingBlob = { logoUrl: string; accent: string; headline: string; description: string; favicon: string; sections: LandingSection[] };

/** Coerce arbitrary stored JSON into a clean, safe LandingSection[]. */
function readSections(raw: unknown): LandingSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).flatMap((s, i) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title : "";
    const body = typeof o.body === "string" ? o.body : "";
    if (!title && !body) return [];
    return [{
      id: typeof o.id === "string" && o.id ? o.id : `s${i}`,
      title,
      body,
      ctaLabel: typeof o.ctaLabel === "string" ? o.ctaLabel : "",
      ctaHref: typeof o.ctaHref === "string" ? o.ctaHref : "",
    }];
  });
}

function readBranding(settings: unknown): BrandingBlob {
  const empty: BrandingBlob = { logoUrl: "", accent: "", headline: "", description: "", favicon: "", sections: [] };
  if (settings && typeof settings === "object") {
    const b = (settings as Record<string, unknown>).branding;
    if (b && typeof b === "object") {
      const o = b as Record<string, unknown>;
      return {
        logoUrl: typeof o.logoUrl === "string" ? o.logoUrl : "",
        accent: typeof o.accent === "string" ? o.accent : "",
        headline: typeof o.headline === "string" ? o.headline : "",
        description: typeof o.description === "string" ? o.description : "",
        favicon: typeof o.favicon === "string" ? o.favicon : "",
        sections: readSections(o.sections),
      };
    }
  }
  return empty;
}

/** Current branding for the owner's Branding tab. */
export async function getPanelBranding(panelId: string): Promise<PanelBranding | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data } = await admin
    .from("panels")
    .select("name, theme, settings, owner_id")
    .eq("id", panelId)
    .maybeSingle();
  if (!data || data.owner_id !== user.id) return null;
  const b = readBranding(data.settings);
  return {
    name: data.name,
    theme: data.theme ?? "obsidian-gold",
    logoUrl: b.logoUrl,
    accent: b.accent,
    headline: b.headline,
    description: b.description,
    favicon: b.favicon,
    sections: b.sections,
  };
}

/** Save panel branding (name, theme, logo, accent, hero headline/description). */
export async function updatePanelBranding(
  panelId: string,
  patch: { name?: string; theme?: string; logoUrl?: string; accent?: string; headline?: string; description?: string; favicon?: string; sections?: LandingSection[] }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: panel } = await admin
    .from("panels")
    .select("settings, owner_id")
    .eq("id", panelId)
    .maybeSingle();
  if (!panel || panel.owner_id !== user.id) return { ok: false, error: "Panel not found" };

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: "Panel name can't be empty." };
    update.name = name;
  }
  if (patch.theme !== undefined) update.theme = patch.theme;

  const brandingKeys = ["logoUrl", "accent", "headline", "description", "favicon", "sections"] as const;
  if (brandingKeys.some((k) => patch[k] !== undefined)) {
    const settings: Record<string, unknown> =
      panel.settings && typeof panel.settings === "object" ? { ...(panel.settings as Record<string, unknown>) } : {};
    const current = readBranding(settings);
    settings.branding = {
      logoUrl: patch.logoUrl !== undefined ? patch.logoUrl.trim() : current.logoUrl,
      accent: patch.accent !== undefined ? patch.accent.trim() : current.accent,
      headline: patch.headline !== undefined ? patch.headline.trim() : current.headline,
      description: patch.description !== undefined ? patch.description.trim() : current.description,
      favicon: patch.favicon !== undefined ? patch.favicon.trim() : current.favicon,
      sections: patch.sections !== undefined
        ? readSections(patch.sections.map((s, i) => ({
            id: s.id || `s${i}`,
            title: (s.title || "").trim(),
            body: (s.body || "").trim(),
            ctaLabel: (s.ctaLabel || "").trim(),
            ctaHref: (s.ctaHref || "").trim(),
          })))
        : current.sections,
    };
    update.settings = settings;
  }

  if (Object.keys(update).length === 0) return { ok: true };
  const { error } = await admin.from("panels").update(update).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
