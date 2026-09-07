"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import type { DesignPricingEntry, DesignPricingMap } from "@/src/lib/design/pricing";

/* Platform-wide (super-admin) settings — key/value rows in `platform_settings`.
   Reads for public-facing values (e.g. the landing walkthrough video) go through
   the service-role client so the public landing can render them; writes are gated
   on the super_admin role. Mirrors the superadmin.ts pattern. */

type Result = { ok: true } | { ok: false; error: string };

const LANDING_VIDEO_KEY = "landing_video";
const SUPPORT_EMAIL_KEY = "support_email";
const DESIGN_PRICING_KEY = "design_pricing";

async function isSuperAdmin(): Promise<boolean> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "super_admin";
}

/** Read the super-admin-set landing walkthrough video URL (public-safe). */
export async function getLandingVideo(): Promise<{ url: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", LANDING_VIDEO_KEY)
    .maybeSingle();
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const url = typeof value.url === "string" ? value.url : "";
  return { url };
}

/** Set (or clear, with "") the landing walkthrough video URL. Super admin only. */
export async function setLandingVideo(url: string): Promise<Result> {
  if (!(await isSuperAdmin())) return { ok: false, error: "Super admin only." };

  const trimmed = (url ?? "").trim();
  if (trimmed) {
    // Only allow http(s) links — this URL is embedded on the public landing.
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, error: "Enter a valid URL (YouTube, Vimeo, or a direct .mp4 link)." };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "The video link must start with http(s)." };
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_settings")
    .upsert({ key: LANDING_VIDEO_KEY, value: { url: trimmed }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Read all design pricing overrides + promos (public-safe — used by the shop + purchase). */
export async function getDesignPricing(): Promise<DesignPricingMap> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", DESIGN_PRICING_KEY)
    .maybeSingle();
  const value = data?.value;
  return value && typeof value === "object" ? (value as DesignPricingMap) : {};
}

/** Set (or clear) one design's price + promo. Super admin only. */
export async function setDesignPricing(designId: string, entry: DesignPricingEntry): Promise<Result> {
  if (!(await isSuperAdmin())) return { ok: false, error: "Super admin only." };
  if (!designId) return { ok: false, error: "Missing design." };

  // Sanitise numbers (non-negative; drop NaN/undefined so they fall back to meta.price).
  const clean: DesignPricingEntry = {};
  if (typeof entry.price === "number" && Number.isFinite(entry.price) && entry.price >= 0) clean.price = Math.round(entry.price * 100) / 100;
  clean.promoActive = !!entry.promoActive;
  if (typeof entry.promoPrice === "number" && Number.isFinite(entry.promoPrice) && entry.promoPrice >= 0) clean.promoPrice = Math.round(entry.promoPrice * 100) / 100;
  const label = entry.promoLabel?.trim();
  if (label) clean.promoLabel = label.slice(0, 40);

  const admin = createAdminClient();
  const current = await getDesignPricing();
  const next: DesignPricingMap = { ...current, [designId]: clean };
  const { error } = await admin
    .from("platform_settings")
    .upsert({ key: DESIGN_PRICING_KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Where owner→Innvil support messages are emailed. "" = fall back to super-admin account emails. */
export async function getSupportEmail(): Promise<{ email: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", SUPPORT_EMAIL_KEY)
    .maybeSingle();
  const value = (data?.value ?? {}) as Record<string, unknown>;
  return { email: typeof value.email === "string" ? value.email : "" };
}

/** Set (or clear, with "") the support destination email. Super admin only. */
export async function setSupportEmail(email: string): Promise<Result> {
  if (!(await isSuperAdmin())) return { ok: false, error: "Super admin only." };
  const trimmed = (email ?? "").trim();
  if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed))
    return { ok: false, error: "Enter a valid email address." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_settings")
    .upsert({ key: SUPPORT_EMAIL_KEY, value: { email: trimmed }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
