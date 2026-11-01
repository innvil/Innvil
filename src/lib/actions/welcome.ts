"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import {
  readWelcomeConfig,
  normalizeWelcomeConfig,
  welcomeSubjectTemplate,
  welcomeBodyTemplate,
  type WelcomeConfig,
} from "@/src/lib/welcome";

/* =========================================================
   Owner-facing config for the automated new-customer welcome message.
   Stored on panels.settings.welcome (JSONB). A brand-new customer auto-receives this
   as a support ticket; replying once grants the configured free credit (customer-auth.ts
   + tickets.ts). Owners can edit the copy entirely or turn it off.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface WelcomeInfo extends WelcomeConfig {
  /** The effective subject template (owner override, else default) — with placeholders. */
  subjectText: string;
  /** The effective body template (owner override, else default) — with placeholders. */
  bodyText: string;
}

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

function toInfo(settings: unknown): WelcomeInfo {
  const cfg = readWelcomeConfig(settings);
  return { ...cfg, subjectText: welcomeSubjectTemplate(cfg), bodyText: welcomeBodyTemplate(cfg) };
}

export async function getWelcomeSettings(panelId: string): Promise<WelcomeInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  return toInfo(ctx.panel.settings);
}

export async function setWelcomeSettings(
  panelId: string,
  input: Partial<WelcomeConfig>
): Promise<Result<WelcomeInfo>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const { admin, user, panel } = ctx;

  const clean = normalizeWelcomeConfig(input);
  const settings = (panel.settings && typeof panel.settings === "object" ? panel.settings : {}) as Record<string, unknown>;
  const updated = { ...settings, welcome: clean };
  const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    panel_id: panelId, actor_id: user.id, action: "welcome.updated",
    meta: { enabled: clean.enabled, creditEnabled: clean.creditEnabled, creditAmount: clean.creditAmount },
  });
  return { ok: true, data: toInfo(updated) };
}
