"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { generatePRFromFacts } from "@/src/lib/pr/generate";
import { generatePRDraft, type PRFactInput } from "@/src/lib/ai/pr-writer";
import { runPRCompliance } from "@/src/lib/ai/pr-compliance";

/* Super-admin PR management (Phase A): manual workflow + scheduler settings.
   AI generation/compliance automation will be layered in Phase B/C. */

async function requireSuperAdmin(): Promise<{ ok: boolean; userId?: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false };
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { ok: data?.role === "super_admin", userId: user.id };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type PRStatus = "draft" | "reviewed" | "approved" | "published_externally" | "rejected";

export interface PRGeneratorSettings {
  campaignId: string;
  campaignName: string;
  intervalDays: number;
  active: boolean;
  nextGenerationDate: string | null;
  lastGeneratedAt: string | null;
  lastPublishedExternallyAt: string | null;
}

export interface PRItem {
  id: string;
  campaignId: string;
  title: string;
  slug: string;
  summary: string;
  body: Array<{ kind: "p" | "h3" | "ul" | "ol" | "quote"; text?: string; items?: string[] }>;
  status: PRStatus;
  source: "ai" | "manual";
  topic: string | null;
  complianceStatus: "pending" | "pass" | "fail";
  externalUrl: string | null;
  externalPublicationName: string | null;
  externalPublicationDate: string | null;
  externalHeadline: string | null;
  externalNotes: string | null;
  publishedExternallyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PRFactLibraryItem {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceUrl: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  createdAt: string;
}

export interface PRClaimSourceItem {
  id: string;
  claimText: string;
  sourceUrl: string | null;
  confidence: number | null;
  factLibraryId: string | null;
  factTitle: string | null;
  createdAt: string;
}

export interface PRComplianceReportItem {
  id: string;
  status: "pass" | "fail";
  summary: string;
  checks: {
    unsupportedClaims: string[];
    fabricatedStatsOrAwards: string[];
    unverifiableQuotes: string[];
    promotionalToneRisks: string[];
    duplicateAngleRisks: string[];
    keywordStuffingRisks: string[];
  };
  rawFeedback: string | null;
  createdAt: string;
}

export interface PRDetails {
  latestCompliance: PRComplianceReportItem | null;
  claims: PRClaimSourceItem[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function revalidatePRSurfaces() {
  try {
    revalidatePath("/superadmin");
  } catch {
    // Safe outside request scope.
  }
}

interface CampaignRow {
  id: string;
  name: string;
  interval_days: number;
  active: boolean;
  next_generation_date: string | null;
  last_generated_at: string | null;
  last_published_externally_at: string | null;
}

async function buildUniquePRSlug(admin: ReturnType<typeof createAdminClient>, title: string): Promise<string> {
  let base = slugify(title);
  if (!base) base = "press-release";
  let slug = base;
  for (let i = 2; i <= 250; i += 1) {
    const { data: exists } = await admin.from("press_releases").select("id").eq("slug", slug).maybeSingle();
    if (!exists?.id) break;
    slug = `${base}-${i}`;
  }
  return slug;
}

async function getOrCreateDefaultCampaign(admin: ReturnType<typeof createAdminClient>): Promise<CampaignRow> {
  const { data: row } = await admin
    .from("pr_campaigns")
    .select("id, name, interval_days, active, next_generation_date, last_generated_at, last_published_externally_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (row) return row as CampaignRow;

  const { data, error } = await admin
    .from("pr_campaigns")
    .insert({ name: "Default PR Campaign", interval_days: 30, active: true })
    .select("id, name, interval_days, active, next_generation_date, last_generated_at, last_published_externally_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not initialize PR campaign.");
  }

  return data as CampaignRow;
}

export async function getPRGeneratorSettings(): Promise<Result<PRGeneratorSettings>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  try {
    const admin = createAdminClient();
    const c = await getOrCreateDefaultCampaign(admin);
    return {
      ok: true,
      data: {
        campaignId: c.id,
        campaignName: c.name,
        intervalDays: c.interval_days,
        active: c.active,
        nextGenerationDate: c.next_generation_date,
        lastGeneratedAt: c.last_generated_at,
        lastPublishedExternallyAt: c.last_published_externally_at,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to load PR settings." };
  }
}

export async function setPRGeneratorSettings(input: { intervalDays: number; active: boolean }): Promise<Result<PRGeneratorSettings>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const intervalDays = Number(input.intervalDays);
  if (!Number.isFinite(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    return { ok: false, error: "Interval must be between 1 and 365 days." };
  }

  const admin = createAdminClient();
  const campaign = await getOrCreateDefaultCampaign(admin);
  const { data, error } = await admin
    .from("pr_campaigns")
    .update({ interval_days: Math.floor(intervalDays), active: !!input.active })
    .eq("id", campaign.id)
    .select("id, name, interval_days, active, next_generation_date, last_generated_at, last_published_externally_at")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Failed to save PR settings." };

  revalidatePRSurfaces();

  return {
    ok: true,
    data: {
      campaignId: data.id,
      campaignName: data.name,
      intervalDays: data.interval_days,
      active: data.active,
      nextGenerationDate: data.next_generation_date,
      lastGeneratedAt: data.last_generated_at,
      lastPublishedExternallyAt: data.last_published_externally_at,
    },
  };
}

interface PRRow {
  id: string;
  campaign_id: string;
  title: string;
  slug: string;
  summary: string;
  body: unknown;
  status: string;
  source: string;
  topic: string | null;
  compliance_status: string;
  external_url: string | null;
  external_publication_name: string | null;
  external_publication_date: string | null;
  external_headline: string | null;
  external_notes: string | null;
  published_externally_at: string | null;
  created_at: string;
  updated_at: string;
}

function normalizePRBody(raw: unknown): PRItem["body"] {
  if (!Array.isArray(raw)) return [];
  const out: PRItem["body"] = [];
  for (const block of raw) {
    if (!block || typeof block !== "object") continue;
    const kind = (block as { kind?: unknown }).kind;
    if (kind !== "p" && kind !== "h3" && kind !== "ul" && kind !== "ol" && kind !== "quote") continue;
    if (kind === "ul" || kind === "ol") {
      const items = ((block as { items?: unknown }).items ?? []) as unknown[];
      const clean = items.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
      if (!clean.length) continue;
      out.push({ kind, items: clean });
      continue;
    }
    const text = typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text.trim() : "";
    if (!text) continue;
    out.push({ kind, text });
  }
  return out;
}

function mapPR(row: PRRow): PRItem {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: normalizePRBody(row.body),
    status: (["draft", "reviewed", "approved", "published_externally", "rejected"].includes(row.status)
      ? row.status
      : "draft") as PRStatus,
    source: row.source === "ai" ? "ai" : "manual",
    topic: row.topic,
    complianceStatus: (["pending", "pass", "fail"].includes(row.compliance_status)
      ? row.compliance_status
      : "pending") as "pending" | "pass" | "fail",
    externalUrl: row.external_url,
    externalPublicationName: row.external_publication_name,
    externalPublicationDate: row.external_publication_date,
    externalHeadline: row.external_headline,
    externalNotes: row.external_notes,
    publishedExternallyAt: row.published_externally_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPressReleases(): Promise<Result<PRItem[]>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("press_releases")
    .select("id, campaign_id, title, slug, summary, body, status, source, topic, compliance_status, external_url, external_publication_name, external_publication_date, external_headline, external_notes, published_externally_at, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: ((data as PRRow[] | null) ?? []).map(mapPR) };
}

export async function createPressReleaseDraft(input: { title: string; summary?: string; topic?: string }): Promise<Result<PRItem>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const title = (input.title ?? "").trim();
  const summary = (input.summary ?? "").trim();
  const topic = (input.topic ?? "").trim();

  if (!title) return { ok: false, error: "Title is required." };

  const admin = createAdminClient();
  const campaign = await getOrCreateDefaultCampaign(admin);
  const slug = await buildUniquePRSlug(admin, title);

  const { data, error } = await admin
    .from("press_releases")
    .insert({
      campaign_id: campaign.id,
      title,
      slug,
      summary,
      topic: topic || null,
      status: "draft",
      source: "manual",
      compliance_status: "pending",
      body: [],
    })
    .select("id, campaign_id, title, slug, summary, body, status, source, topic, compliance_status, external_url, external_publication_name, external_publication_date, external_headline, external_notes, published_externally_at, created_at, updated_at")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create draft." };

  revalidatePRSurfaces();
  return { ok: true, data: mapPR(data as PRRow) };
}

export async function createPressReleaseDraftsBulk(
  items: Array<{ title: string; summary?: string; topic?: string }>
): Promise<Result<{ added: number; skipped: number }>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const normalized = (items ?? []).map((item) => ({
    title: (item.title ?? "").trim(),
    summary: (item.summary ?? "").trim(),
    topic: (item.topic ?? "").trim(),
  }));

  if (normalized.length === 0) return { ok: false, error: "No rows to import." };

  const admin = createAdminClient();
  const campaign = await getOrCreateDefaultCampaign(admin);

  let added = 0;
  let skipped = 0;

  for (const item of normalized) {
    if (!item.title) {
      skipped += 1;
      continue;
    }

    const slug = await buildUniquePRSlug(admin, item.title);
    const { error } = await admin.from("press_releases").insert({
      campaign_id: campaign.id,
      title: item.title,
      slug,
      summary: item.summary,
      topic: item.topic || null,
      status: "draft",
      source: "manual",
      compliance_status: "pending",
      body: [],
    });

    if (error) {
      skipped += 1;
      continue;
    }
    added += 1;
  }

  revalidatePRSurfaces();
  return { ok: true, data: { added, skipped } };
}

export async function setPressReleaseStatus(id: string, status: Exclude<PRStatus, "published_externally">): Promise<Result<null>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  if (!["draft", "reviewed", "approved", "rejected"].includes(status)) {
    return { ok: false, error: "Invalid status." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("press_releases")
    .update({ status })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePRSurfaces();
  return { ok: true, data: null };
}

export async function markPublishedExternally(
  id: string,
  payload: {
    externalUrl: string;
    publicationName?: string;
    publicationDate: string;
    externalHeadline?: string;
    notes?: string;
  }
): Promise<Result<null>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, error: "Super admin only." };

  const externalUrl = (payload.externalUrl ?? "").trim();
  const publicationName = (payload.publicationName ?? "").trim();
  const publicationDate = (payload.publicationDate ?? "").trim();
  const externalHeadline = (payload.externalHeadline ?? "").trim();
  const notes = (payload.notes ?? "").trim();

  if (!externalUrl) return { ok: false, error: "External publication URL is required." };
  if (!publicationDate) return { ok: false, error: "External publication date is required." };

  const parsedDate = new Date(publicationDate);
  if (Number.isNaN(parsedDate.getTime())) return { ok: false, error: "Publication date is invalid." };

  const admin = createAdminClient();

  const { data: pr, error: getErr } = await admin
    .from("press_releases")
    .select("campaign_id")
    .eq("id", id)
    .maybeSingle();

  if (getErr || !pr?.campaign_id) return { ok: false, error: getErr?.message ?? "PR not found." };

  const publishedAt = new Date().toISOString();
  const isoDate = parsedDate.toISOString().slice(0, 10);

  const { error } = await admin
    .from("press_releases")
    .update({
      status: "published_externally",
      external_url: externalUrl,
      external_publication_name: publicationName || null,
      external_publication_date: isoDate,
      external_headline: externalHeadline || null,
      external_notes: notes || null,
      published_externally_at: publishedAt,
      published_externally_by: auth.userId,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  const { data: campaign } = await admin
    .from("pr_campaigns")
    .select("interval_days")
    .eq("id", pr.campaign_id)
    .maybeSingle();

  const intervalDays = Math.max(1, Number(campaign?.interval_days ?? 30));
  const next = new Date(isoDate);
  next.setUTCDate(next.getUTCDate() + intervalDays);

  await admin
    .from("pr_campaigns")
    .update({
      last_published_externally_at: `${isoDate}T00:00:00.000Z`,
      next_generation_date: next.toISOString().slice(0, 10),
    })
    .eq("id", pr.campaign_id);

  revalidatePRSurfaces();
  return { ok: true, data: null };
}

export async function generatePRNow(input?: { topic?: string; force?: boolean }): Promise<Result<{ id: string; title: string; slug: string; complianceStatus: "pass" | "fail" }>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const out = await generatePRFromFacts({
    topic: input?.topic,
    force: input?.force,
  });

  if (!out.ok) return { ok: false, error: out.error };
  revalidatePRSurfaces();
  return { ok: true, data: { id: out.id, title: out.title, slug: out.slug, complianceStatus: out.complianceStatus } };
}

async function loadActiveFactsForGeneration(admin: ReturnType<typeof createAdminClient>): Promise<PRFactInput[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("pr_fact_library")
    .select("id, title, category, content, source_url, effective_from, effective_to")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  return ((data as Array<{
    id: string;
    title: string;
    category: string;
    content: string;
    source_url: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }> | null) ?? [])
    .filter((f) => (!f.effective_from || f.effective_from <= today) && (!f.effective_to || f.effective_to >= today))
    .map((f) => ({
      id: f.id,
      title: f.title,
      category: f.category,
      content: f.content,
      sourceUrl: f.source_url,
    }));
}

export async function generatePRDraftFromQueue(id: string): Promise<Result<PRItem>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("press_releases")
    .select("id, title, summary, topic, status")
    .eq("id", id)
    .maybeSingle();

  if (existingError || !existing) return { ok: false, error: existingError?.message ?? "PR item not found." };
  if (existing.status === "published_externally") {
    return { ok: false, error: "Cannot regenerate a PR that is already marked as published externally." };
  }

  const facts = await loadActiveFactsForGeneration(admin);
  if (!facts.length) return { ok: false, error: "No active PR facts available. Add at least one fact first." };

  const topic = (existing.topic ?? "").trim() || existing.title;
  const draft = await generatePRDraft({ topic, facts });
  if (!draft.ok) return { ok: false, error: draft.error };

  const compliance = await runPRCompliance({
    title: draft.draft.title,
    summary: draft.draft.summary,
    body: draft.draft.body,
    facts,
  });
  const complianceStatus = compliance.ok ? compliance.report.status : "fail";

  const summary = (existing.summary ?? "").trim() || draft.draft.summary;
  const { data: updated, error: updateError } = await admin
    .from("press_releases")
    .update({
      summary,
      body: draft.draft.body,
      source: "ai",
      compliance_status: complianceStatus,
      status: "draft",
    })
    .eq("id", id)
    .select("id, campaign_id, title, slug, summary, body, status, source, topic, compliance_status, external_url, external_publication_name, external_publication_date, external_headline, external_notes, published_externally_at, created_at, updated_at")
    .single();

  if (updateError || !updated) return { ok: false, error: updateError?.message ?? "Failed to update PR draft body." };

  await admin.from("pr_claim_sources").delete().eq("press_release_id", id);
  await admin.from("pr_compliance_reports").delete().eq("press_release_id", id);

  if (draft.draft.claims.length) {
    await admin.from("pr_claim_sources").insert(
      draft.draft.claims.map((claim) => ({
        press_release_id: id,
        claim_text: claim.claimText,
        fact_library_id: claim.factId,
        source_url: claim.sourceUrl,
        confidence: claim.confidence,
      }))
    );
  }

  if (compliance.ok) {
    await admin.from("pr_compliance_reports").insert({
      press_release_id: id,
      status: compliance.report.status,
      checks: compliance.report.checks,
      summary: compliance.report.summary,
      raw_feedback: compliance.report.rawFeedback,
    });
  } else {
    await admin.from("pr_compliance_reports").insert({
      press_release_id: id,
      status: "fail",
      checks: {
        unsupportedClaims: [],
        fabricatedStatsOrAwards: [],
        unverifiableQuotes: [],
        promotionalToneRisks: ["Compliance pass failed to execute"],
        duplicateAngleRisks: [],
        keywordStuffingRisks: [],
      },
      summary: "Compliance engine failed; manual review required.",
      raw_feedback: compliance.error,
    });
  }

  revalidatePRSurfaces();
  return { ok: true, data: mapPR(updated as PRRow) };
}

interface FactRow {
  id: string;
  title: string;
  category: string;
  content: string;
  source_url: string | null;
  effective_from: string | null;
  effective_to: string | null;
  active: boolean;
  created_at: string;
}

function mapFact(row: FactRow): PRFactLibraryItem {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    content: row.content,
    sourceUrl: row.source_url,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    active: row.active,
    createdAt: row.created_at,
  };
}

interface ComplianceRow {
  id: string;
  status: string;
  summary: string;
  checks: unknown;
  raw_feedback: string | null;
  created_at: string;
}

interface ClaimRow {
  id: string;
  claim_text: string;
  source_url: string | null;
  confidence: number | null;
  fact_library_id: string | null;
  created_at: string;
}

function toIssueArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 30);
}

function mapCompliance(row: ComplianceRow): PRComplianceReportItem {
  const checksRaw = row.checks && typeof row.checks === "object" ? (row.checks as Record<string, unknown>) : {};
  return {
    id: row.id,
    status: row.status === "fail" ? "fail" : "pass",
    summary: row.summary,
    checks: {
      unsupportedClaims: toIssueArray(checksRaw.unsupportedClaims),
      fabricatedStatsOrAwards: toIssueArray(checksRaw.fabricatedStatsOrAwards),
      unverifiableQuotes: toIssueArray(checksRaw.unverifiableQuotes),
      promotionalToneRisks: toIssueArray(checksRaw.promotionalToneRisks),
      duplicateAngleRisks: toIssueArray(checksRaw.duplicateAngleRisks),
      keywordStuffingRisks: toIssueArray(checksRaw.keywordStuffingRisks),
    },
    rawFeedback: row.raw_feedback,
    createdAt: row.created_at,
  };
}

export async function listPRFactLibrary(): Promise<Result<PRFactLibraryItem[]>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pr_fact_library")
    .select("id, title, category, content, source_url, effective_from, effective_to, active, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: ((data as FactRow[] | null) ?? []).map(mapFact) };
}

export async function createPRFact(input: {
  title: string;
  category?: string;
  content: string;
  sourceUrl?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  active?: boolean;
}): Promise<Result<PRFactLibraryItem>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, error: "Super admin only." };

  const title = (input.title ?? "").trim();
  const category = (input.category ?? "general").trim() || "general";
  const content = (input.content ?? "").trim();
  const sourceUrl = (input.sourceUrl ?? "").trim();
  const effectiveFrom = (input.effectiveFrom ?? "").trim();
  const effectiveTo = (input.effectiveTo ?? "").trim();

  if (!title) return { ok: false, error: "Fact title is required." };
  if (!content) return { ok: false, error: "Fact content is required." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pr_fact_library")
    .insert({
      title,
      category,
      content,
      source_url: sourceUrl || null,
      effective_from: effectiveFrom || null,
      effective_to: effectiveTo || null,
      active: input.active ?? true,
      created_by: auth.userId,
    })
    .select("id, title, category, content, source_url, effective_from, effective_to, active, created_at")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create PR fact." };
  revalidatePRSurfaces();
  return { ok: true, data: mapFact(data as FactRow) };
}

export async function createPRFactsBulk(
  items: Array<{
    title: string;
    category?: string;
    content: string;
    sourceUrl?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    active?: boolean;
  }>
): Promise<Result<{ added: number; skipped: number }>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, error: "Super admin only." };

  const rows = (items ?? []).map((item) => ({
    title: (item.title ?? "").trim(),
    category: (item.category ?? "general").trim() || "general",
    content: (item.content ?? "").trim(),
    source_url: (item.sourceUrl ?? "").trim() || null,
    effective_from: (item.effectiveFrom ?? "").trim() || null,
    effective_to: (item.effectiveTo ?? "").trim() || null,
    active: item.active ?? true,
    created_by: auth.userId,
  }));

  if (rows.length === 0) return { ok: false, error: "No rows to import." };

  const validRows = rows.filter((row) => row.title && row.content);
  const skipped = rows.length - validRows.length;
  if (validRows.length === 0) return { ok: false, error: "No valid fact rows found." };

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("pr_fact_library")
    .insert(validRows, { count: "exact" });

  if (error) return { ok: false, error: error.message };

  revalidatePRSurfaces();
  return { ok: true, data: { added: Number(count ?? validRows.length), skipped } };
}

export async function setPRFactActive(id: string, active: boolean): Promise<Result<null>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("pr_fact_library")
    .update({ active })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePRSurfaces();
  return { ok: true, data: null };
}

export async function deletePRFact(id: string): Promise<Result<null>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("pr_fact_library")
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePRSurfaces();
  return { ok: true, data: null };
}

export async function getPressReleaseDetails(id: string): Promise<Result<PRDetails>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, error: "Super admin only." };

  const admin = createAdminClient();

  const [{ data: latestComplianceData, error: complianceError }, { data: claimRowsData, error: claimsError }] = await Promise.all([
    admin
      .from("pr_compliance_reports")
      .select("id, status, summary, checks, raw_feedback, created_at")
      .eq("press_release_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("pr_claim_sources")
      .select("id, claim_text, source_url, confidence, fact_library_id, created_at")
      .eq("press_release_id", id)
      .order("created_at", { ascending: true })
      .limit(300),
  ]);

  if (complianceError) return { ok: false, error: complianceError.message };
  if (claimsError) return { ok: false, error: claimsError.message };

  const claimRows = (claimRowsData as ClaimRow[] | null) ?? [];
  const factIds = Array.from(new Set(claimRows.map((r) => r.fact_library_id).filter((v): v is string => !!v)));

  const factTitleById = new Map<string, string>();
  if (factIds.length > 0) {
    const { data: facts, error: factErr } = await admin
      .from("pr_fact_library")
      .select("id, title")
      .in("id", factIds);
    if (factErr) return { ok: false, error: factErr.message };
    for (const fact of (facts as Array<{ id: string; title: string }> | null) ?? []) {
      factTitleById.set(fact.id, fact.title);
    }
  }

  const claims: PRClaimSourceItem[] = claimRows.map((row) => ({
    id: row.id,
    claimText: row.claim_text,
    sourceUrl: row.source_url,
    confidence: row.confidence,
    factLibraryId: row.fact_library_id,
    factTitle: row.fact_library_id ? (factTitleById.get(row.fact_library_id) ?? null) : null,
    createdAt: row.created_at,
  }));

  const latestCompliance = latestComplianceData ? mapCompliance(latestComplianceData as ComplianceRow) : null;

  return {
    ok: true,
    data: {
      latestCompliance,
      claims,
    },
  };
}
