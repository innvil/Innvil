"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getProviderCredentials,
  fetchServices,
  ProviderError,
  type ProviderServiceDTO,
} from "@/src/lib/providers";
import { computeSellRate } from "@/src/lib/money";
import type { ProviderRow, ServiceRow, MarkupKind, ServiceStatus } from "@/src/types/db";

type Result<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

const PROVIDER_COLS =
  "id, panel_id, name, api_url, status, balance, currency, last_balance_sync, notes, created_at, updated_at";

async function ownsPanel(admin: SupabaseClient, userId: string, panelId: string): Promise<boolean> {
  const { data } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

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

async function serviceOwnerPanel(
  admin: SupabaseClient,
  userId: string,
  serviceId: string
): Promise<ServiceRow | null> {
  const { data } = await admin.from("services").select("*").eq("id", serviceId).maybeSingle();
  const svc = (data as ServiceRow) ?? null;
  if (!svc) return null;
  if (!(await ownsPanel(admin, userId, svc.panel_id))) return null;
  return svc;
}

/* ---------------------------------------------------------------------------
   Keyword detection: platform (top category) + service type (sub-category)
   --------------------------------------------------------------------------- */

// Known platforms get a clean, consistent label. Anything not listed here is
// derived from the service name by detectPlatform() (so LinkedIn, Bluesky, Kick,
// Rumble, etc. become their own category rather than falling into "Other").
const PLATFORM_KEYWORDS: Array<[RegExp, string]> = [
  [/instagram|\binsta\b|\big\b/i, "instagram"],
  [/tiktok|tik[\s-]?tok|\btt\b/i, "tiktok"],
  [/youtube|you[\s-]?tube|\byt\b/i, "youtube"],
  [/twitter|\btweets?\b|\bx\b/i, "x"],
  [/facebook|\bfb\b|meta/i, "facebook"],
  [/telegram|\btg\b/i, "telegram"],
  [/spotify/i, "spotify"],
  [/linkedin/i, "linkedin"],
  [/twitch/i, "twitch"],
  [/discord/i, "discord"],
  [/reddit/i, "reddit"],
  [/pinterest/i, "pinterest"],
  [/snapchat|\bsnap\b/i, "snapchat"],
  [/\bthreads\b/i, "threads"],
  [/soundcloud/i, "soundcloud"],
  [/\bkick\b/i, "kick"],
  [/rumble/i, "rumble"],
];

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X / Twitter",
  facebook: "Facebook", telegram: "Telegram", spotify: "Spotify", linkedin: "LinkedIn",
  twitch: "Twitch", discord: "Discord", reddit: "Reddit", pinterest: "Pinterest",
  snapchat: "Snapchat", threads: "Threads", soundcloud: "SoundCloud", kick: "Kick",
  rumble: "Rumble",
};

const SUBCATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/watch[\s-]?hours?|watch[\s-]?time|watchtime/i, "Watch Hours"],
  [/subscribers?|\bsubs\b/i, "Subscribers"],
  [/followers?/i, "Followers"],
  [/retweets?|reposts?|\brt\b/i, "Retweets"],
  [/comments?/i, "Comments"],
  [/\bshares?\b/i, "Shares"],
  [/\bsaves?\b/i, "Saves"],
  [/likes?|reactions?/i, "Likes"],
  [/plays?|streams?/i, "Plays"],
  [/members?/i, "Members"],
  [/\blive\b/i, "Live"],
  [/reach|impressions?/i, "Reach"],
  [/views?/i, "Views"],
];
const SUBCATEGORY_FALLBACK = "Other";

// Original behavior: a known platform is detected by keyword ANYWHERE in the name,
// so leading country/quality prefixes ("USA Instagram Followers") don't matter.
function guessPlatformKey(text: string): string | null {
  for (const [re, p] of PLATFORM_KEYWORDS) if (re.test(text)) return p;
  return null;
}
function guessSubcategory(text: string): string | null {
  for (const [re, s] of SUBCATEGORY_KEYWORDS) if (re.test(text)) return s;
  return null;
}

// Words that are NOT a platform: service types + common quality/descriptor tokens.
// Used to strip a service name down to its platform token.
const PLATFORM_STOPWORDS = new Set<string>([
  // service types
  "followers", "follower", "subscribers", "subscriber", "subs", "sub", "subscribe",
  "likes", "like", "views", "view", "comments", "comment", "retweets", "retweet",
  "reposts", "repost", "shares", "share", "saves", "save", "plays", "play", "streams",
  "stream", "members", "member", "reactions", "reaction", "live", "reach", "impressions",
  "impression", "watch", "hours", "hour", "watchtime", "upvotes", "upvote", "downvotes",
  "downvote", "following", "traffic", "visits", "visit", "clicks", "click", "votes", "vote",
  // quality / descriptor tokens
  "custom", "real", "active", "users", "user", "hq", "high", "quality", "account",
  "accounts", "bot", "bots", "cheap", "cheapest", "fast", "fastest", "instant", "premium",
  "mixed", "refill", "nonrefill", "non", "no", "drop", "nondrop", "guaranteed", "lifetime",
  "speed", "server", "package", "worldwide", "world", "global", "organic", "best", "new",
  "old", "aged", "targeted", "random", "auto", "manual", "services", "service", "and",
  "with", "for", "the", "of", "plus", "pro", "max", "min", "free", "paid", "super", "ultra",
  "slow", "stable", "permanent", "genuine", "quick", "power", "boost",
]);

// Title-case so casing variants collapse to one category (bluesky/BlueSky → Bluesky).
function tidyPlatform(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// Stable lowercase key for a platform label — used for unknown platforms
// (Bluesky, Kick, …) so their services still get a non-null `platform` value
// (which powers the customer platform buttons + the owner logo editor).
function slugPlatform(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "") || "other";
}

// Countries / nationalities / regions that show up as prefixes in SMM service
// names — never the platform, so they're skipped when deriving an unknown one.
const COUNTRY_STOPWORDS = new Set<string>([
  "usa", "us", "america", "american", "uk", "british", "england", "brazil", "brazilian",
  "brasil", "india", "indian", "indonesia", "indonesian", "turkey", "turkish", "arab",
  "arabic", "russia", "russian", "china", "chinese", "japan", "japanese", "korea",
  "korean", "germany", "german", "france", "french", "spain", "spanish", "italy",
  "italian", "mexico", "mexican", "canada", "canadian", "australia", "australian",
  "egypt", "egyptian", "saudi", "uae", "emirates", "nigeria", "nigerian", "pakistan",
  "pakistani", "bangladesh", "bengali", "vietnam", "vietnamese", "thailand", "thai",
  "philippines", "filipino", "malaysia", "malaysian", "iran", "iranian", "iraq", "iraqi",
  "netherlands", "dutch", "poland", "polish", "portugal", "portuguese", "greece", "greek",
  "argentina", "argentinian", "colombia", "colombian", "peru", "chile", "chilean",
  "venezuela", "europe", "european", "asia", "asian", "latin", "latino", "africa",
  "african", "international", "country", "countries", "mena", "gcc", "eu", "kuwait",
  "qatar", "morocco", "algeria", "tunisia", "ukraine", "ukrainian", "romania", "romanian",
  "israel", "israeli", "singapore", "hongkong", "taiwan", "sweden", "swedish", "norway",
  "finland", "denmark",
]);

/**
 * Main category (platform). First: a KNOWN platform matched anywhere in the name
 * (original logic — leading country/quality prefixes don't matter). Only when no
 * known platform is found do we derive an UNKNOWN platform: strip [brackets]/(parens),
 * then take the first token that isn't a service type, a quality descriptor, or a country.
 */
function detectPlatform(name: string): { label: string; key: string } {
  const known = guessPlatformKey(name);
  if (known) return { label: PLATFORM_LABEL[known], key: known };

  const cleaned = name
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Za-z0-9\s]/g, " ");
  for (const w of cleaned.split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(w)) continue;
    const lw = w.toLowerCase();
    if (PLATFORM_STOPWORDS.has(lw) || COUNTRY_STOPWORDS.has(lw)) continue;
    const label = tidyPlatform(w);
    return { label, key: slugPlatform(label) };
  }
  return { label: "Other", key: "other" };
}

async function providerServiceList(
  admin: SupabaseClient,
  provider: ProviderRow
): Promise<ProviderServiceDTO[]> {
  const creds = await getProviderCredentials(provider.id, provider.api_url);
  return fetchServices(creds);
}

/** Get-or-create a category by (panel, provider, name, parent). */
async function getOrCreateCategory(
  admin: SupabaseClient,
  panelId: string,
  providerId: string,
  name: string,
  parentId: string | null
): Promise<string> {
  let q = admin
    .from("provider_categories")
    .select("id")
    .eq("panel_id", panelId)
    .eq("provider_id", providerId)
    .eq("name", name);
  q = parentId === null ? q.is("parent_id", null) : q.eq("parent_id", parentId);
  const { data: existing, error: selErr } = await q.maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return existing.id as string;
  const { data: created, error: insErr } = await admin
    .from("provider_categories")
    .insert({ panel_id: panelId, provider_id: providerId, name, parent_id: parentId })
    .select("id")
    .single();
  if (insErr || !created) throw new Error(insErr?.message ?? "Could not create category");
  return created.id as string;
}

/** Map raw DB errors to a friendly hint (e.g. the 0003 migration not being run). */
function friendlyCategoryError(e: unknown): string {
  const m = e instanceof Error ? e.message : "Something went wrong";
  if (/parent_id/i.test(m)) {
    return "Run migration 0003_category_hierarchy.sql first (missing provider_categories.parent_id).";
  }
  return m;
}

/* --------------------------------------------------------------------------- */

/** Fetch a provider's catalog for the import picker + which are already imported. */
export async function fetchImportableServices(
  providerId: string
): Promise<Result<{ services: ProviderServiceDTO[]; importedIds: string[] }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const provider = await loadAuthorizedProvider(admin, user.id, providerId);
  if (!provider) return { ok: false, error: "Provider not found" };
  try {
    const services = await providerServiceList(admin, provider);
    const { data: existing } = await admin
      .from("services")
      .select("provider_service_id")
      .eq("provider_id", providerId);
    const importedIds = (existing ?? [])
      .map((r) => r.provider_service_id)
      .filter((x): x is string => Boolean(x));
    return { ok: true, data: { services, importedIds } };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.message : "Failed to fetch services" };
  }
}

/**
 * Import selected provider services. Auto-creates a two-level category tree:
 * platform category (e.g. "Instagram Services") → sub-category (e.g. "Followers"),
 * detected from each service's category + name. One markup rule applies to all.
 */
export async function importServices(
  providerId: string,
  opts: { providerServiceIds: string[]; markupKind: MarkupKind; markupValue: number }
): Promise<Result<{ imported: number; skipped: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const provider = await loadAuthorizedProvider(admin, user.id, providerId);
  if (!provider) return { ok: false, error: "Provider not found" };

  let catalog: ProviderServiceDTO[];
  try {
    catalog = await providerServiceList(admin, provider);
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.message : "Failed to fetch services" };
  }

  const wanted = new Set(opts.providerServiceIds.map(String));
  const chosen = catalog.filter((s) => wanted.has(String(s.service)));

  const { data: existing } = await admin
    .from("services")
    .select("provider_service_id")
    .eq("provider_id", providerId);
  const already = new Set((existing ?? []).map((r) => String(r.provider_service_id)));

  try {
  const platformCache = new Map<string, string>(); // label -> id
  const subCache = new Map<string, string>(); // `${platformId}|${sub}` -> id
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const s of chosen) {
    const psid = String(s.service);
    if (already.has(psid)) {
      skipped++;
      continue;
    }
    const name = s.name ?? "";
    const text = `${name} ${s.category ?? ""}`;
    const { label: platformLabel, key: platformKey } = detectPlatform(name);

    let platformId = platformCache.get(platformLabel);
    if (!platformId) {
      platformId = await getOrCreateCategory(admin, provider.panel_id, providerId, platformLabel, null);
      platformCache.set(platformLabel, platformId);
    }

    const subName = guessSubcategory(text) ?? SUBCATEGORY_FALLBACK;
    const subKey = `${platformId}|${subName}`;
    let subId = subCache.get(subKey);
    if (!subId) {
      subId = await getOrCreateCategory(admin, provider.panel_id, providerId, subName, platformId);
      subCache.set(subKey, subId);
    }

    const providerRate = Number(s.rate) || 0;
    rows.push({
      panel_id: provider.panel_id,
      provider_id: providerId,
      provider_service_id: psid,
      category_id: subId,
      name: s.name,
      type: s.type ?? null,
      platform: platformKey,
      provider_rate: providerRate,
      markup_kind: opts.markupKind,
      markup_value: opts.markupValue,
      sell_rate: computeSellRate(providerRate, opts.markupKind, opts.markupValue),
      min: Number(s.min) || 1,
      max: Number(s.max) || 1000000,
      status: "active",
      sort_order: 0,
      last_synced_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    // Assign this panel's own sequential service IDs (1, 2, 3…), independent of
    // the provider's IDs.
    const { data: maxRow } = await admin
      .from("services")
      .select("local_id")
      .eq("panel_id", provider.panel_id)
      .order("local_id", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    let next = (maxRow?.local_id ?? 0) + 1;
    for (const r of rows) r.local_id = next++;

    const { error } = await admin.from("services").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, data: { imported: rows.length, skipped } };
  } catch (e) {
    return { ok: false, error: friendlyCategoryError(e) };
  }
}

export interface ServiceVM {
  id: string;
  localId: number | null;
  name: string;
  description: string | null;
  category: string | null;
  platform: string | null;
  providerRate: number;
  markupKind: MarkupKind;
  markupValue: number;
  sellRate: number;
  profit: number;
  min: number;
  max: number;
  status: ServiceStatus;
  providerId: string | null;
  providerServiceId: string | null;
  lastSyncedAt: string | null;
}

function toServiceVM(r: ServiceRow, categoryName: string | null): ServiceVM {
  const providerRate = Number(r.provider_rate);
  const sellRate = Number(r.sell_rate);
  return {
    id: r.id,
    localId: r.local_id,
    name: r.name,
    description: r.description,
    category: categoryName,
    platform: r.platform,
    providerRate,
    markupKind: r.markup_kind,
    markupValue: Number(r.markup_value),
    sellRate,
    profit: Math.round((sellRate - providerRate + Number.EPSILON) * 10000) / 10000,
    min: r.min,
    max: r.max,
    status: r.status,
    providerId: r.provider_id,
    providerServiceId: r.provider_service_id,
    lastSyncedAt: r.last_synced_at,
  };
}

export interface CatalogSub {
  id: string | null;
  name: string;
  services: ServiceVM[];
}
export interface CatalogPlatform {
  id: string | null;
  name: string;
  count: number;
  subs: CatalogSub[];
  /** Platform key of the services under this group (for logo/label overrides). */
  platformKey: string | null;
  /** Custom monochrome logo path stored on the panel, if the owner set one. */
  icon: string | null;
}

/**
 * The panel's catalog as a nested tree: platform category → sub-category →
 * services. Handles both the new 2-level data and any older flat categories
 * (a top-level category with services attached becomes a "General" sub).
 */
export async function listCatalog(panelId: string): Promise<CatalogPlatform[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  if (!(await ownsPanel(admin, user.id, panelId))) return [];

  const [{ data: cats }, { data: svcs }, { data: panelRow }] = await Promise.all([
    admin.from("provider_categories").select("id, name, parent_id").eq("panel_id", panelId),
    admin.from("services").select("*").eq("panel_id", panelId).order("name", { ascending: true }),
    admin.from("panels").select("settings").eq("id", panelId).maybeSingle(),
  ]);
  const platformMeta = readPlatformMeta(panelRow?.settings);

  const catById = new Map<string, { id: string; name: string; parent_id: string | null }>(
    (cats ?? []).map((c) => [c.id as string, c as { id: string; name: string; parent_id: string | null }])
  );

  const platforms = new Map<string, CatalogPlatform>();
  const ensurePlatform = (id: string | null, name: string): CatalogPlatform => {
    const key = id ?? `_${name}`;
    let node = platforms.get(key);
    if (!node) {
      node = { id, name, count: 0, subs: [], platformKey: null, icon: null };
      platforms.set(key, node);
    }
    return node;
  };
  const ensureSub = (p: CatalogPlatform, id: string | null, name: string): CatalogSub => {
    let sub = p.subs.find((s) => s.name === name && s.id === id);
    if (!sub) {
      sub = { id, name, services: [] };
      p.subs.push(sub);
    }
    return sub;
  };

  for (const raw of (svcs as ServiceRow[]) ?? []) {
    const cat = raw.category_id ? catById.get(raw.category_id) : null;
    let platformNode: CatalogPlatform;
    let subName: string;
    let subId: string | null;

    if (cat && cat.parent_id) {
      const parent = catById.get(cat.parent_id);
      platformNode = ensurePlatform(parent?.id ?? null, parent?.name ?? "Other Services");
      subName = cat.name;
      subId = cat.id;
    } else if (cat) {
      platformNode = ensurePlatform(cat.id, cat.name);
      subName = "General";
      subId = null;
    } else {
      platformNode = ensurePlatform(null, "Uncategorized");
      subName = "General";
      subId = null;
    }

    ensureSub(platformNode, subId, subName).services.push(toServiceVM(raw, subName));
    if (!platformNode.platformKey && raw.platform) platformNode.platformKey = raw.platform;
    platformNode.count++;
  }

  const result = [...platforms.values()];
  result.sort((a, b) => a.name.localeCompare(b.name));
  for (const p of result) {
    p.subs.sort((a, b) => a.name.localeCompare(b.name));
    // Every real platform group gets a stable key (so the owner can always set a
    // logo), falling back to a slug of its name when services predate the fix.
    if (!p.platformKey && p.id) p.platformKey = slugPlatform(p.name);
    if (p.platformKey) p.icon = platformMeta[p.platformKey]?.icon ?? null;
  }
  return result;
}

/** Edit an imported service. Changing the markup recomputes the sell rate. */
export async function updateService(
  serviceId: string,
  patch: {
    name?: string;
    description?: string | null;
    markupKind?: MarkupKind;
    markupValue?: number;
  }
): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const svc = await serviceOwnerPanel(admin, user.id, serviceId);
  if (!svc) return { ok: false, error: "Service not found" };

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;

  const kind = patch.markupKind ?? svc.markup_kind;
  const value = patch.markupValue ?? Number(svc.markup_value);
  if (patch.markupKind !== undefined || patch.markupValue !== undefined) {
    update.markup_kind = kind;
    update.markup_value = value;
    update.sell_rate = computeSellRate(Number(svc.provider_rate), kind, value);
  }

  const { error } = await admin.from("services").update(update).eq("id", serviceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteService(serviceId: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const svc = await serviceOwnerPanel(admin, user.id, serviceId);
  if (!svc) return { ok: false, error: "Service not found" };
  const { error } = await admin.from("services").delete().eq("id", serviceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Refresh imported services from the provider: rate, min/max, availability; recompute sell rate. */
export async function syncProviderServices(
  providerId: string
): Promise<Result<{ updated: number; disabled: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const provider = await loadAuthorizedProvider(admin, user.id, providerId);
  if (!provider) return { ok: false, error: "Provider not found" };

  let catalog: ProviderServiceDTO[];
  try {
    catalog = await providerServiceList(admin, provider);
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.message : "Failed to fetch services" };
  }
  const byId = new Map(catalog.map((s) => [String(s.service), s]));

  const { data: imported } = await admin
    .from("services")
    .select("id, provider_service_id, markup_kind, markup_value")
    .eq("provider_id", providerId);

  const now = new Date().toISOString();
  let updated = 0;
  let disabled = 0;

  for (const svc of imported ?? []) {
    const dto = byId.get(String(svc.provider_service_id));
    if (!dto) {
      await admin.from("services").update({ status: "disabled", last_synced_at: now }).eq("id", svc.id);
      disabled++;
      continue;
    }
    const providerRate = Number(dto.rate) || 0;
    await admin
      .from("services")
      .update({
        provider_rate: providerRate,
        sell_rate: computeSellRate(providerRate, svc.markup_kind, Number(svc.markup_value)),
        min: Number(dto.min) || 1,
        max: Number(dto.max) || 1000000,
        status: "active",
        last_synced_at: now,
      })
      .eq("id", svc.id);
    updated++;
  }
  return { ok: true, data: { updated, disabled } };
}

/**
 * Re-derive platform (main category) + service type (sub-category) from each
 * existing service's NAME and rebuild the 2-level tree — regardless of how the
 * provider split its own categories. Then drop now-empty leaf categories.
 * Use this to reorganize services imported before the 2-level scheme.
 */
export async function recategorizeServices(
  panelId: string
): Promise<Result<{ updated: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(admin, user.id, panelId))) return { ok: false, error: "Panel not found" };

  try {
  const { data: svcs } = await admin
    .from("services")
    .select("id, name, provider_id")
    .eq("panel_id", panelId);

  // Categorize EVERY service, including ones whose provider was removed
  // (provider_id null) — those otherwise get stuck "Uncategorized" forever.
  const services = svcs ?? [];
  if (services.length === 0) return { ok: true, data: { updated: 0 } };

  // 1. Compute the target platform + sub for every service in memory.
  const plans = services.map((s) => {
    const name = s.name ?? "";
    const { label: platformLabel, key: platformKey } = detectPlatform(name);
    return {
      id: s.id as string,
      provId: (s.provider_id as string | null) ?? null,
      platformLabel,
      subName: guessSubcategory(name) ?? SUBCATEGORY_FALLBACK,
      platformKey,
    };
  });

  // 2. Load existing categories; index platform categories by NAME (panel-scoped)
  //    and sub-categories by parent+name. Keying by name — NOT provider — means a
  //    service whose provider was removed consolidates into the existing platform
  //    category instead of a null-provider duplicate, and any leftover duplicates
  //    end up empty and get cleaned up below.
  const { data: existingCats } = await admin
    .from("provider_categories")
    .select("id, name, parent_id")
    .eq("panel_id", panelId);

  const platformByName = new Map<string, string>(); // platform name -> category id
  for (const c of existingCats ?? []) {
    if (c.parent_id === null) platformByName.set(c.name, c.id as string);
  }

  // 3. Create any missing platform categories (by name).
  const neededPlatforms = [...new Set(plans.map((p) => p.platformLabel))].filter(
    (n) => !platformByName.has(n)
  );
  if (neededPlatforms.length) {
    const { data: ins, error } = await admin
      .from("provider_categories")
      .insert(neededPlatforms.map((name) => ({ panel_id: panelId, name, parent_id: null })))
      .select("id, name");
    if (error) throw new Error(error.message);
    for (const c of ins ?? []) platformByName.set(c.name as string, c.id as string);
  }

  const subByKey = new Map<string, string>(); // `${parentId}|${name}` -> category id
  for (const c of existingCats ?? []) {
    if (c.parent_id !== null) subByKey.set(`${c.parent_id}|${c.name}`, c.id as string);
  }

  // 4. Create any missing sub-categories (by parent + name).
  const neededSubs = new Map<string, { parentId: string; name: string }>();
  for (const p of plans) {
    const parentId = platformByName.get(p.platformLabel)!;
    const k = `${parentId}|${p.subName}`;
    if (!subByKey.has(k)) neededSubs.set(k, { parentId, name: p.subName });
  }
  if (neededSubs.size) {
    const { data: ins, error } = await admin
      .from("provider_categories")
      .insert([...neededSubs.values()].map((v) => ({ panel_id: panelId, name: v.name, parent_id: v.parentId })))
      .select("id, name, parent_id");
    if (error) throw new Error(error.message);
    for (const c of ins ?? []) subByKey.set(`${c.parent_id}|${c.name}`, c.id as string);
  }

  // 5. Group services by target (sub, platformKey) and update in bulk (chunked).
  const groups = new Map<string, { subId: string; platformKey: string; ids: string[] }>();
  for (const p of plans) {
    const parentId = platformByName.get(p.platformLabel)!;
    const subId = subByKey.get(`${parentId}|${p.subName}`)!;
    const gk = `${subId}|${p.platformKey}`;
    const g = groups.get(gk) ?? { subId, platformKey: p.platformKey, ids: [] };
    g.ids.push(p.id);
    groups.set(gk, g);
  }
  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  await Promise.all(
    [...groups.values()].flatMap((g) =>
      chunk(g.ids, 200).map((ids) =>
        admin.from("services").update({ category_id: g.subId, platform: g.platformKey }).in("id", ids)
      )
    )
  );
  const updated = plans.length;

  // Clean up empty categories (no services, no children), repeating so an emptied
  // parent is removed once its children are gone.
  for (let pass = 0; pass < 5; pass++) {
    const [{ data: allCats }, { data: used }] = await Promise.all([
      admin.from("provider_categories").select("id, parent_id").eq("panel_id", panelId),
      admin.from("services").select("category_id").eq("panel_id", panelId),
    ]);
    const usedIds = new Set((used ?? []).map((r) => r.category_id).filter(Boolean));
    const parentIds = new Set((allCats ?? []).map((c) => c.parent_id).filter(Boolean));
    const orphans = (allCats ?? [])
      .filter((c) => !usedIds.has(c.id) && !parentIds.has(c.id))
      .map((c) => c.id);
    if (!orphans.length) break;
    await admin.from("provider_categories").delete().in("id", orphans);
  }

  return { ok: true, data: { updated } };
  } catch (e) {
    return { ok: false, error: friendlyCategoryError(e) };
  }
}

/** Enable/disable an imported service. */
export async function setServiceStatus(
  serviceId: string,
  status: ServiceStatus
): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const svc = await serviceOwnerPanel(admin, user.id, serviceId);
  if (!svc) return { ok: false, error: "Service not found" };
  const { error } = await admin.from("services").update({ status }).eq("id", serviceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* --------------------------------------------------------------------------- */
/* Bulk actions (§3)                                                            */
/* --------------------------------------------------------------------------- */

/**
 * Split ids into chunks so a `.in(...)` filter never blows the request URL length
 * limit (hundreds of UUIDs in one query string can be rejected/truncated by the
 * server, silently deleting/updating only part of the selection).
 */
function chunkIds<T>(arr: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Filter a set of service ids to those on panels the user owns. */
async function authorizeServiceIds(
  admin: SupabaseClient,
  userId: string,
  serviceIds: string[]
): Promise<string[]> {
  if (serviceIds.length === 0) return [];
  const rows: Array<{ id: string; panel_id: string }> = [];
  for (const c of chunkIds(serviceIds)) {
    const { data } = await admin.from("services").select("id, panel_id").in("id", c);
    if (data) rows.push(...(data as Array<{ id: string; panel_id: string }>));
  }
  const panelOk = new Map<string, boolean>();
  const verified: string[] = [];
  for (const s of rows) {
    let ok = panelOk.get(s.panel_id);
    if (ok === undefined) {
      ok = await ownsPanel(admin, userId, s.panel_id);
      panelOk.set(s.panel_id, ok);
    }
    if (ok) verified.push(s.id);
  }
  return verified;
}

export async function bulkSetServiceStatus(
  serviceIds: string[],
  status: ServiceStatus
): Promise<Result<{ count: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const ids = await authorizeServiceIds(admin, user.id, serviceIds);
  if (ids.length === 0) return { ok: true, data: { count: 0 } };
  for (const c of chunkIds(ids)) {
    const { error } = await admin.from("services").update({ status }).in("id", c);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, data: { count: ids.length } };
}

export async function bulkDeleteServices(
  serviceIds: string[]
): Promise<Result<{ count: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const ids = await authorizeServiceIds(admin, user.id, serviceIds);
  if (ids.length === 0) return { ok: true, data: { count: 0 } };
  // Delete in chunks and count rows actually removed (not just the intended set).
  let deleted = 0;
  for (const c of chunkIds(ids)) {
    const { data, error } = await admin.from("services").delete().in("id", c).select("id");
    if (error) return { ok: false, error: error.message };
    deleted += data?.length ?? 0;
  }
  return { ok: true, data: { count: deleted } };
}

/** Set the same markup on many services and recompute each sell rate. */
export async function bulkSetMarkup(
  serviceIds: string[],
  markupKind: MarkupKind,
  markupValue: number
): Promise<Result<{ count: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const ids = await authorizeServiceIds(admin, user.id, serviceIds);
  if (ids.length === 0) return { ok: true, data: { count: 0 } };

  const svcs: Array<{ id: string; provider_rate: number }> = [];
  for (const c of chunkIds(ids)) {
    const { data } = await admin.from("services").select("id, provider_rate").in("id", c);
    if (data) svcs.push(...(data as Array<{ id: string; provider_rate: number }>));
  }
  // Sell rate depends on provider_rate, so group services with the same cost and
  // update each group (chunked to keep the `.in()` URL bounded).
  const byRate = new Map<number, string[]>();
  for (const s of svcs) {
    const rate = Number(s.provider_rate);
    (byRate.get(rate) ?? byRate.set(rate, []).get(rate)!).push(s.id);
  }
  for (const [rate, gids] of byRate.entries()) {
    for (const c of chunkIds(gids)) {
      const { error } = await admin
        .from("services")
        .update({
          markup_kind: markupKind,
          markup_value: markupValue,
          sell_rate: computeSellRate(rate, markupKind, markupValue),
        })
        .in("id", c);
      if (error) return { ok: false, error: error.message };
    }
  }
  return { ok: true, data: { count: ids.length } };
}

/* =========================================================
   Category management + per-platform logos
   ========================================================= */

type StoredPlatformMeta = Record<string, { label?: string; icon?: string | null }>;

/** Read `settings.platforms` off a panel settings blob (defensive). */
function readPlatformMeta(settings: unknown): StoredPlatformMeta {
  if (settings && typeof settings === "object") {
    const p = (settings as Record<string, unknown>).platforms;
    if (p && typeof p === "object") return p as StoredPlatformMeta;
  }
  return {};
}

async function loadAuthorizedCategory(
  admin: SupabaseClient,
  userId: string,
  categoryId: string
): Promise<{ id: string; panel_id: string; parent_id: string | null } | null> {
  const { data } = await admin
    .from("provider_categories")
    .select("id, panel_id, parent_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (!data) return null;
  if (!(await ownsPanel(admin, userId, data.panel_id as string))) return null;
  return data as { id: string; panel_id: string; parent_id: string | null };
}

/**
 * Delete a category and everything under it: the category, its child
 * sub-categories, and all services attached to any of them.
 */
export async function deleteCategory(categoryId: string): Promise<Result<{ services: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const cat = await loadAuthorizedCategory(admin, user.id, categoryId);
  if (!cat) return { ok: false, error: "Category not found" };

  // This category + any direct children (2-level tree).
  const { data: children } = await admin
    .from("provider_categories")
    .select("id")
    .eq("parent_id", categoryId);
  const catIds = [categoryId, ...((children ?? []).map((c) => c.id as string))];

  // Services live on the leaf categories (and sometimes the parent directly).
  const svcIds: string[] = [];
  for (const c of chunkIds(catIds)) {
    const { data } = await admin.from("services").select("id").in("category_id", c);
    if (data) svcIds.push(...data.map((s) => s.id as string));
  }
  let deleted = 0;
  for (const c of chunkIds(svcIds)) {
    const { data, error } = await admin.from("services").delete().in("id", c).select("id");
    if (error) return { ok: false, error: error.message };
    deleted += data?.length ?? 0;
  }

  const { error: cErr } = await admin.from("provider_categories").delete().in("id", catIds);
  if (cErr) return { ok: false, error: cErr.message };
  return { ok: true, data: { services: deleted } };
}

/**
 * Set (or clear) a per-platform display logo/label, stored on the panel's
 * `settings.platforms[key]`. `icon` is a monochrome SVG path (`d`); pass null/""
 * to clear it. Used to give owner-added platforms (LinkedIn, Bluesky, …) a logo.
 */
export async function setPanelPlatformIcon(
  panelId: string,
  platformKey: string,
  icon: string | null,
  label?: string
): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(admin, user.id, panelId)))
    return { ok: false, error: "Not authorized for this panel" };
  if (!platformKey) return { ok: false, error: "Missing platform" };

  const { data: panelRow } = await admin
    .from("panels")
    .select("settings")
    .eq("id", panelId)
    .maybeSingle();
  const settings: Record<string, unknown> =
    panelRow?.settings && typeof panelRow.settings === "object"
      ? { ...(panelRow.settings as Record<string, unknown>) }
      : {};

  const platforms: StoredPlatformMeta = { ...readPlatformMeta(settings) };
  const entry: { label?: string; icon?: string | null } = { ...(platforms[platformKey] ?? {}) };
  if (icon && icon.trim()) entry.icon = icon.trim();
  else delete entry.icon;
  if (label !== undefined) {
    if (label.trim()) entry.label = label.trim();
    else delete entry.label;
  }
  if (Object.keys(entry).length === 0) delete platforms[platformKey];
  else platforms[platformKey] = entry;
  settings.platforms = platforms;

  const { error } = await admin.from("panels").update({ settings }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
