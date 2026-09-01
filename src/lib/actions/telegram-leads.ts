"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { scrapeTlgrmCategories } from "@/src/lib/marketing/telegram-directory-fetch";
import { isKnownTlgrmCategory, isWithinLeadMemberRange } from "@/src/lib/marketing/telegram-directory";
import { scrapeVcSheetCategories } from "@/src/lib/marketing/vcsheet-directory-fetch";
import { isKnownVcSheetCategory } from "@/src/lib/marketing/vcsheet-directory";

/**
 * Super-admin-only lead RESEARCH tool for Innvil's own marketing outreach.
 * Every export is gated on the super_admin role, mirroring blog-admin.ts's
 * exact pattern. This is lead collection only -- nothing in this file (or
 * anything it calls) sends a message anywhere, to Telegram, X, email, or
 * otherwise. See telegram-directory.ts and vcsheet-directory.ts's own doc
 * comments for the full per-source scope/safety statement.
 *
 * Two sources feed the SAME `telegram_leads` table (migration 0107 + 0113):
 * Telegram communities (tlgrm.eu, `platform: 'telegram'`) and VC funds
 * (vcsheet.com, `platform: 'website'`). `link` carries the real destination
 * URL for a non-Telegram row -- toLead() falls back to the historical
 * `https://t.me/<username>` construction only when `link` is null, so every
 * existing Telegram-sourced row keeps working unchanged.
 *
 * Removal is PERMANENT: deleteTelegramLead records the lead's username into
 * telegram_lead_exclusions before deleting it, and every insert path below
 * (both scrapers + the manual CSV import) checks that table first -- a
 * removed lead is never silently re-added by a later run.
 *
 * X/Twitter is deliberately NOT scraped directly here -- X has no public,
 * unauthenticated way to search/list accounts, and scraping it without the
 * official (paid) API would be unreliable and against its ToS. vcsheet.com
 * already surfaces each fund's own real, publicly-listed X handle (and its
 * partners') as part of its structured data, which is folded into the
 * description text below -- that's the real, safe way this tool reaches X
 * presence data for VCs today.
 */

async function requireSuperAdmin(): Promise<{ ok: boolean; userId?: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false };
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { ok: data?.role === "super_admin", userId: user.id };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type TelegramLeadStatus = "new" | "contacted" | "responded" | "declined" | "converted" | "invalid";
export type LeadPlatform = "telegram" | "website";

export interface TelegramLead {
  id: string;
  source: string;
  platform: LeadPlatform;
  category: string | null;
  name: string;
  username: string;
  link: string;
  subscriberCount: number | null;
  description: string | null;
  status: TelegramLeadStatus;
  notes: string | null;
  contactedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type LeadRow = {
  id: string; source: string; platform: LeadPlatform | null; category: string | null; name: string; username: string;
  link: string | null; subscriber_count: number | null; description: string | null; status: TelegramLeadStatus;
  notes: string | null; contacted_at: string | null; created_at: string; updated_at: string;
};

function toLead(row: LeadRow): TelegramLead {
  return {
    id: row.id, source: row.source, platform: row.platform ?? "telegram", category: row.category, name: row.name, username: row.username,
    link: row.link ?? `https://t.me/${row.username}`, subscriberCount: row.subscriber_count, description: row.description,
    status: row.status, notes: row.notes, contactedAt: row.contacted_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** The full set of permanently-excluded usernames (lowercased), checked by
 *  every insert path below before adding a NEW lead. A lead already in the
 *  table is never affected by this (only fresh inserts are gated) -- this
 *  is what makes a removed lead stay removed across future scrapes/imports. */
async function getExcludedUsernames(admin: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  const { data } = await admin.from("telegram_lead_exclusions").select("username");
  return new Set(((data as Array<{ username: string }> | null) ?? []).map((r) => r.username.toLowerCase()));
}

export async function listTelegramLeads(filters?: { status?: TelegramLeadStatus; category?: string; platform?: LeadPlatform; search?: string }): Promise<TelegramLead[]> {
  if (!(await requireSuperAdmin()).ok) return [];
  const admin = createAdminClient();
  let query = admin.from("telegram_leads").select("*").order("created_at", { ascending: false }).limit(1000);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.category) query = query.eq("category", filters.category);
  if (filters?.platform) query = query.eq("platform", filters.platform);
  const { data, error } = await query;
  if (error || !data) return [];
  let rows = data as LeadRow[];
  if (filters?.search) {
    const q = filters.search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.username.toLowerCase().includes(q));
  }
  return rows.map(toLead);
}

export interface ScrapeSummary {
  added: number;
  updated: number;
  outOfRange: number;
  excluded: number;
  perCategory: Array<{ category: string; found: number; pagesFetched: number; error?: string }>;
}

/** Runs the real directory scrape for the given categories, then upserts
 *  by username (globally unique) -- a re-scrape UPDATES subscriber_count/
 *  description/category/source on an already-known lead, but never
 *  touches its status/notes/contacted_at, so manual outreach progress is
 *  never clobbered by a later scrape.
 *
 *  Only entries reporting a member/subscriber count within
 *  [TELEGRAM_LEAD_MIN_MEMBERS, TELEGRAM_LEAD_MAX_MEMBERS] are kept -- an
 *  entry outside that range, or with no reported count at all, is skipped
 *  entirely (never inserted, never updated) rather than added and filtered
 *  out later in the UI. A username in telegram_lead_exclusions (a
 *  previously-removed lead) is likewise never re-inserted.
 *
 *  IMPORTANT, honestly disclosed rather than silently ignored: tlgrm.eu
 *  (this scraper's only wired source) lists Telegram CHANNELS only -- its
 *  own markup labels every entry "channel" (aria-label="Verified channel",
 *  button text "Preview channel"), it has no /groups/ section, and its nav
 *  only offers "Channels". Verified directly against the live site before
 *  writing this comment, not assumed. There is currently no reliable signal
 *  anywhere in the scraped data to determine "this is a public GROUP, not a
 *  channel" -- so this pass does NOT add a fake/guessed group/channel field.
 *  Every lead this tool currently produces is, in reality, a channel. If
 *  public-group-only leads are still needed, a genuinely different,
 *  verified directory source is required -- flag this back rather than
 *  building against a source that can't satisfy it. */
export async function runTelegramLeadScrape(categories: string[], maxPagesPerCategory?: number): Promise<Result<ScrapeSummary>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  // "adult" is never reachable here even if somehow submitted -- it's
  // structurally excluded from TLGRM_CATEGORIES itself, so isKnownTlgrmCategory
  // can never narrow to it (a compile-time guarantee, not just a runtime one).
  const clean = [...new Set(categories.map((c) => c.trim().toLowerCase()))].filter(isKnownTlgrmCategory);
  if (clean.length === 0) return { ok: false, error: "No valid categories selected." };

  const admin = createAdminClient();
  const excluded = await getExcludedUsernames(admin);
  const results = await scrapeTlgrmCategories(clean, maxPagesPerCategory);

  let added = 0;
  let updated = 0;
  let outOfRange = 0;
  let excludedCount = 0;
  const perCategory: ScrapeSummary["perCategory"] = [];
  for (const result of results) {
    perCategory.push({ category: result.category, found: result.entries.length, pagesFetched: result.pagesFetched, error: result.error });
    for (const entry of result.entries) {
      if (!isWithinLeadMemberRange(entry.subscriberCount)) { outOfRange++; continue; }
      if (excluded.has(entry.username.toLowerCase())) { excludedCount++; continue; }
      const { data: existing } = await admin.from("telegram_leads").select("id").eq("username", entry.username).maybeSingle();
      const nowIso = new Date().toISOString();
      if (existing) {
        await admin.from("telegram_leads").update({
          name: entry.name, category: result.category, subscriber_count: entry.subscriberCount,
          description: entry.description, source: "tlgrm.eu", updated_at: nowIso,
        }).eq("id", existing.id);
        updated++;
      } else {
        const { error: insertError } = await admin.from("telegram_leads").insert({
          source: "tlgrm.eu", platform: "telegram", category: result.category, name: entry.name, username: entry.username,
          subscriber_count: entry.subscriberCount, description: entry.description, status: "new",
        });
        // A 23505 (unique-violation) race here means another concurrent
        // scrape/import already inserted this username -- harmless, not an
        // error worth surfacing.
        if (!insertError) added++;
      }
    }
  }
  return { ok: true, data: { added, updated, outOfRange, excluded: excludedCount, perCategory } };
}

export interface VcScrapeSummary {
  added: number;
  updated: number;
  excluded: number;
  perCategory: Array<{ category: string; found: number; fundsFetched: number; error?: string }>;
}

/** Runs the real VC-fund directory scrape (vcsheet.com) for the given
 *  categories. Same upsert-by-username / never-touch-status-or-notes /
 *  permanent-exclusion discipline as runTelegramLeadScrape above, adapted
 *  to a fund's own real website as its `link` (never a fabricated t.me
 *  URL) and `platform: 'website'`. Each fund's real X/LinkedIn handles
 *  (when it has them) are folded into `description` -- there's no
 *  separate column for them, and this keeps them visible in the existing
 *  leads table without a UI change. */
export async function runVcSheetScrape(categories: string[], maxFundsPerCategory?: number): Promise<Result<VcScrapeSummary>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const clean = [...new Set(categories.map((c) => c.trim().toLowerCase()))].filter(isKnownVcSheetCategory);
  if (clean.length === 0) return { ok: false, error: "No valid categories selected." };

  const admin = createAdminClient();
  const excluded = await getExcludedUsernames(admin);
  const results = await scrapeVcSheetCategories(clean, maxFundsPerCategory, excluded);

  let added = 0;
  let updated = 0;
  let excludedCount = 0;
  const perCategory: VcScrapeSummary["perCategory"] = [];
  for (const result of results) {
    perCategory.push({ category: result.category, found: result.entries.length, fundsFetched: result.fundsFetched, error: result.error });
    for (const entry of result.entries) {
      if (excluded.has(entry.slug.toLowerCase())) { excludedCount++; continue; }
      const description = [entry.description, entry.twitter ? `X: ${entry.twitter}` : null, entry.linkedin ? `LinkedIn: ${entry.linkedin}` : null]
        .filter((v): v is string => Boolean(v)).join(" · ") || null;
      const { data: existing } = await admin.from("telegram_leads").select("id").eq("username", entry.slug).maybeSingle();
      const nowIso = new Date().toISOString();
      if (existing) {
        await admin.from("telegram_leads").update({
          name: entry.name, category: result.category, link: entry.website, description,
          source: "vcsheet.com", updated_at: nowIso,
        }).eq("id", existing.id);
        updated++;
      } else {
        const { error: insertError } = await admin.from("telegram_leads").insert({
          source: "vcsheet.com", platform: "website", category: result.category, name: entry.name, username: entry.slug,
          link: entry.website, description, status: "new",
        });
        if (!insertError) added++;
      }
    }
  }
  return { ok: true, data: { added, updated, excluded: excludedCount, perCategory } };
}

export async function setTelegramLeadStatus(id: string, status: TelegramLeadStatus): Promise<Result<null>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "contacted" || status === "responded" || status === "converted") patch.contacted_at = new Date().toISOString();
  const { error } = await admin.from("telegram_leads").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function setTelegramLeadNotes(id: string, notes: string): Promise<Result<null>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { error } = await admin.from("telegram_leads").update({ notes: notes.trim() || null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Deletes a lead AND permanently excludes its username from ever being
 *  re-added by a future scrape/import -- the exclusion is recorded FIRST
 *  (best-effort; a duplicate-insert race here is harmless, see the
 *  unique-violation tolerance) so there's no window where a retry of this
 *  same delete could leave the lead removed but NOT excluded. */
export async function deleteTelegramLead(id: string): Promise<Result<null>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();

  const { data: lead } = await admin.from("telegram_leads").select("username").eq("id", id).maybeSingle();
  if (lead?.username) {
    const { error: exclusionError } = await admin.from("telegram_lead_exclusions").insert({ username: lead.username, excluded_by: auth.userId ?? null });
    if (exclusionError && exclusionError.code !== "23505") {
      // A real (non-duplicate) failure to record the exclusion -- don't
      // silently delete a lead that could then just reappear next scrape.
      return { ok: false, error: "Could not record this removal as permanent. Please try again." };
    }
  }

  const { error } = await admin.from("telegram_leads").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Manual fallback ingestion -- for leads researched by hand, or via a
 *  source other than the built-in scraper (a different directory, a
 *  spreadsheet a team member already compiled, etc.). Mirrors
 *  blog-admin.ts's addTopicsBulk: skips blanks/duplicates, never throws on
 *  a malformed row, reports what was actually added vs skipped. A
 *  permanently-excluded username is treated the same as an already-seen
 *  one -- skipped, not re-added. */
export async function importTelegramLeadsCsv(
  rows: Array<{ name: string; username: string; subscriberCount?: number | null; description?: string | null; category?: string | null }>,
): Promise<Result<{ added: number; skipped: number }>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();

  const { data: existing } = await admin.from("telegram_leads").select("username");
  const seen = new Set(((existing as Array<{ username: string }> | null) ?? []).map((r) => r.username.toLowerCase()));
  const excluded = await getExcludedUsernames(admin);

  const toInsert: Array<{ name: string; username: string; subscriber_count: number | null; description: string | null; category: string | null; source: string }> = [];
  let skipped = 0;
  for (const row of rows) {
    const username = (row.username ?? "").trim().replace(/^@/, "");
    const name = (row.name ?? "").trim();
    if (!username || !name || seen.has(username.toLowerCase()) || excluded.has(username.toLowerCase())) { skipped++; continue; }
    seen.add(username.toLowerCase());
    toInsert.push({
      name, username, subscriber_count: row.subscriberCount ?? null, description: row.description?.trim() || null,
      category: row.category?.trim().toLowerCase() || null, source: "manual",
    });
  }
  if (toInsert.length === 0) return { ok: true, data: { added: 0, skipped } };
  const { error } = await admin.from("telegram_leads").insert(toInsert);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { added: toInsert.length, skipped } };
}
