"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { scrapeTlgrmCategories } from "@/src/lib/marketing/telegram-directory-fetch";
import { isKnownTlgrmCategory } from "@/src/lib/marketing/telegram-directory";

/**
 * Super-admin-only Telegram lead RESEARCH tool for Innvil's own marketing
 * outreach. Every export is gated on the super_admin role, mirroring
 * blog-admin.ts's exact pattern. This is lead collection only -- nothing
 * in this file (or anything it calls) sends a message anywhere, to
 * Telegram or otherwise. See telegram-directory.ts's doc comment for the
 * full scope/safety statement.
 */

async function requireSuperAdmin(): Promise<{ ok: boolean; userId?: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false };
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { ok: data?.role === "super_admin", userId: user.id };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type TelegramLeadStatus = "new" | "contacted" | "responded" | "declined" | "converted" | "invalid";

export interface TelegramLead {
  id: string;
  source: string;
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
  id: string; source: string; category: string | null; name: string; username: string;
  subscriber_count: number | null; description: string | null; status: TelegramLeadStatus;
  notes: string | null; contacted_at: string | null; created_at: string; updated_at: string;
};

function toLead(row: LeadRow): TelegramLead {
  return {
    id: row.id, source: row.source, category: row.category, name: row.name, username: row.username,
    link: `https://t.me/${row.username}`, subscriberCount: row.subscriber_count, description: row.description,
    status: row.status, notes: row.notes, contactedAt: row.contacted_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listTelegramLeads(filters?: { status?: TelegramLeadStatus; category?: string; search?: string }): Promise<TelegramLead[]> {
  if (!(await requireSuperAdmin()).ok) return [];
  const admin = createAdminClient();
  let query = admin.from("telegram_leads").select("*").order("created_at", { ascending: false }).limit(1000);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.category) query = query.eq("category", filters.category);
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
  perCategory: Array<{ category: string; found: number; pagesFetched: number; error?: string }>;
}

/** Runs the real directory scrape for the given categories, then upserts
 *  by username (globally unique) -- a re-scrape UPDATES subscriber_count/
 *  description/category/source on an already-known lead, but never
 *  touches its status/notes/contacted_at, so manual outreach progress is
 *  never clobbered by a later scrape. */
export async function runTelegramLeadScrape(categories: string[], maxPagesPerCategory?: number): Promise<Result<ScrapeSummary>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  // "adult" is never reachable here even if somehow submitted -- it's
  // structurally excluded from TLGRM_CATEGORIES itself, so isKnownTlgrmCategory
  // can never narrow to it (a compile-time guarantee, not just a runtime one).
  const clean = [...new Set(categories.map((c) => c.trim().toLowerCase()))].filter(isKnownTlgrmCategory);
  if (clean.length === 0) return { ok: false, error: "No valid categories selected." };

  const admin = createAdminClient();
  const results = await scrapeTlgrmCategories(clean, maxPagesPerCategory);

  let added = 0;
  let updated = 0;
  const perCategory: ScrapeSummary["perCategory"] = [];
  for (const result of results) {
    perCategory.push({ category: result.category, found: result.entries.length, pagesFetched: result.pagesFetched, error: result.error });
    for (const entry of result.entries) {
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
          source: "tlgrm.eu", category: result.category, name: entry.name, username: entry.username,
          subscriber_count: entry.subscriberCount, description: entry.description, status: "new",
        });
        // A 23505 (unique-violation) race here means another concurrent
        // scrape/import already inserted this username -- harmless, not an
        // error worth surfacing.
        if (!insertError) added++;
      }
    }
  }
  return { ok: true, data: { added, updated, perCategory } };
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

export async function deleteTelegramLead(id: string): Promise<Result<null>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { error } = await admin.from("telegram_leads").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Manual fallback ingestion -- for leads researched by hand, or via a
 *  source other than the built-in scraper (a different directory, a
 *  spreadsheet a team member already compiled, etc.). Mirrors
 *  blog-admin.ts's addTopicsBulk: skips blanks/duplicates, never throws on
 *  a malformed row, reports what was actually added vs skipped. */
export async function importTelegramLeadsCsv(
  rows: Array<{ name: string; username: string; subscriberCount?: number | null; description?: string | null; category?: string | null }>,
): Promise<Result<{ added: number; skipped: number }>> {
  if (!(await requireSuperAdmin()).ok) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();

  const { data: existing } = await admin.from("telegram_leads").select("username");
  const seen = new Set(((existing as Array<{ username: string }> | null) ?? []).map((r) => r.username.toLowerCase()));

  const toInsert: Array<{ name: string; username: string; subscriber_count: number | null; description: string | null; category: string | null; source: string }> = [];
  let skipped = 0;
  for (const row of rows) {
    const username = (row.username ?? "").trim().replace(/^@/, "");
    const name = (row.name ?? "").trim();
    if (!username || !name || seen.has(username.toLowerCase())) { skipped++; continue; }
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
