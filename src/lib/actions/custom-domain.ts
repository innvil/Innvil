"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import { PANEL_ROOT_DOMAIN } from "@/src/lib/config";
import {
  vercelConfigured, addProjectDomain, getProjectDomain, removeProjectDomain,
  type DomainVerification,
} from "@/src/lib/vercel/domains";

/* =========================================================
   §10 CUSTOM DOMAINS (owner)
   Owner connects their own domain (e.g. mypanel.com) to a panel. We store it on
   panels.custom_domain, register it on this Vercel project (so Vercel routes it
   here + issues SSL), and surface the DNS records + verification status. The proxy
   resolves the host → panel via custom_domain. Owner-auth + ownership in code.
   ========================================================= */

type Result<T = void> = ({ ok: true } & (T extends void ? object : { data: T })) | { ok: false; error: string };

const VERCEL_CNAME = "cname.vercel-dns.com";
const HOST_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export interface RecommendedRecord { type: "A" | "CNAME" | "ALIAS/ANAME"; name: string; value: string; note?: string; }

export interface DomainInfo {
  subdomain: string;
  customDomain: string | null;
  verified: boolean;
  misconfigured: boolean;
  vercelManaged: boolean; // whether the Vercel API is wired up
  verification: DomainVerification[];
  recommended: RecommendedRecord[]; // preferred/fallback DNS records for the owner
  error?: string;
}

async function ownsPanel(admin: SupabaseClient, userId: string, panelId: string): Promise<{ subdomain: string; custom_domain: string | null } | null> {
  const { data } = await admin
    .from("panels")
    .select("subdomain, custom_domain, owner_id")
    .eq("id", panelId)
    .maybeSingle();
  if (!data || data.owner_id !== userId) return null;
  return { subdomain: data.subdomain as string, custom_domain: (data.custom_domain as string) ?? null };
}

/** Is this an apex domain (exactly registrable.tld, 2 labels)? */
function isApex(domain: string): boolean {
  return domain.split(".").length === 2;
}
function recommendFor(domain: string): RecommendedRecord[] {
  if (isApex(domain)) {
    return [
      { type: "CNAME", name: "www", value: VERCEL_CNAME, note: "Connect www directly to Vercel (works on almost all DNS providers)." },
      { type: "ALIAS/ANAME", name: "@", value: VERCEL_CNAME, note: "Optional root/apex setup if your provider supports ALIAS/ANAME or CNAME flattening." },
    ];
  }
  return [{ type: "CNAME", name: domain.split(".")[0], value: VERCEL_CNAME }];
}

/** Current custom-domain state for the Domain tab. */
export async function getDomainInfo(panelId: string): Promise<DomainInfo | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const panel = await ownsPanel(admin, user.id, panelId);
  if (!panel) return null;

  const base: DomainInfo = {
    subdomain: panel.subdomain,
    customDomain: panel.custom_domain,
    verified: false,
    misconfigured: false,
    vercelManaged: vercelConfigured(),
    verification: [],
    recommended: panel.custom_domain ? recommendFor(panel.custom_domain) : [],
  };
  if (!panel.custom_domain) return base;

  if (vercelConfigured()) {
    const status = await getProjectDomain(panel.custom_domain);
    return { ...base, verified: status.verified, misconfigured: !!status.misconfigured, verification: status.verification, error: status.error };
  }
  return base;
}

/** Connect (or replace) the panel's custom domain. */
export async function setCustomDomain(panelId: string, domainRaw: string): Promise<Result<DomainInfo>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const panel = await ownsPanel(admin, user.id, panelId);
  if (!panel) return { ok: false, error: "Panel not found" };

  const domain = domainRaw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!HOST_RE.test(domain)) return { ok: false, error: "Enter a valid domain, e.g. panel.yourbrand.com" };
  if (domain === PANEL_ROOT_DOMAIN || domain.endsWith(`.${PANEL_ROOT_DOMAIN}`)) {
    return { ok: false, error: `You already have a free ${PANEL_ROOT_DOMAIN} subdomain — enter a domain you own.` };
  }

  // Must be unique across panels.
  const { data: taken } = await admin
    .from("panels")
    .select("id")
    .ilike("custom_domain", domain)
    .neq("id", panelId)
    .maybeSingle();
  if (taken) return { ok: false, error: "That domain is already connected to another panel." };

  // If replacing a different domain, detach the old one from Vercel first.
  if (panel.custom_domain && panel.custom_domain !== domain) {
    await removeProjectDomain(panel.custom_domain).catch(() => null);
  }

  // Register on Vercel (best-effort — store the domain either way).
  let vercelError: string | undefined;
  if (vercelConfigured()) {
    const status = await addProjectDomain(domain);
    if (!status.ok) vercelError = status.error;
  }

  const { error } = await admin.from("panels").update({ custom_domain: domain }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };

  const info = await getDomainInfo(panelId);
  if (!info) return { ok: false, error: "Saved, but could not read status." };
  return { ok: true, data: { ...info, error: vercelError ?? info.error } };
}

/** Re-check DNS/SSL verification with Vercel. */
export async function verifyCustomDomain(panelId: string): Promise<Result<DomainInfo>> {
  const info = await getDomainInfo(panelId);
  if (!info) return { ok: false, error: "Panel not found" };
  if (!info.customDomain) return { ok: false, error: "No custom domain set." };
  return { ok: true, data: info };
}

/** Disconnect the custom domain (detaches from Vercel + clears the column). */
export async function removeCustomDomain(panelId: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const panel = await ownsPanel(admin, user.id, panelId);
  if (!panel) return { ok: false, error: "Panel not found" };
  if (panel.custom_domain) await removeProjectDomain(panel.custom_domain).catch(() => null);
  const { error } = await admin.from("panels").update({ custom_domain: null }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
