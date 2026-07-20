"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";

/* Platform-wide (super-admin) settings — key/value rows in `platform_settings`.
   Reads for public-facing values (e.g. the landing walkthrough video) go through
   the service-role client so the public landing can render them; writes are gated
   on the super_admin role. Mirrors the superadmin.ts pattern. */

type Result = { ok: true } | { ok: false; error: string };

const LANDING_VIDEO_KEY = "landing_video";

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
