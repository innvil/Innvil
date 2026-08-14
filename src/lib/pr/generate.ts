import "server-only";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { generatePRDraft, type PRFactInput } from "@/src/lib/ai/pr-writer";
import { runPRCompliance } from "@/src/lib/ai/pr-compliance";

export type GeneratePROutcome =
  | { ok: true; id: string; title: string; slug: string; complianceStatus: "pass" | "fail" }
  | { ok: false; error: string };

export type ScheduledGeneratePROutcome =
  | { ok: true; generated: true; id: string; title: string; slug: string; complianceStatus: "pass" | "fail" }
  | { ok: true; generated: false; reason: "inactive" | "not_due" | "blocked_unpublished" }
  | { ok: false; error: string };

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

interface CampaignRow {
  id: string;
  interval_days: number;
  active?: boolean;
  next_generation_date?: string | null;
}

async function getOrCreateDefaultCampaign(): Promise<CampaignRow> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pr_campaigns")
    .select("id, interval_days, active, next_generation_date")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data) return data as CampaignRow;

  const { data: inserted, error } = await admin
    .from("pr_campaigns")
    .insert({ name: "Default PR Campaign", interval_days: 30, active: true })
    .select("id, interval_days, active, next_generation_date")
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? "Could not initialize PR campaign.");
  }

  return inserted as CampaignRow;
}

export async function runScheduledPRGeneration(): Promise<ScheduledGeneratePROutcome> {
  try {
    const campaign = await getOrCreateDefaultCampaign();

    if (campaign.active === false) {
      return { ok: true, generated: false, reason: "inactive" };
    }

    const today = new Date().toISOString().slice(0, 10);
    if (campaign.next_generation_date && campaign.next_generation_date > today) {
      return { ok: true, generated: false, reason: "not_due" };
    }

    const blocked = await unresolvedExists(campaign.id);
    if (blocked) {
      return { ok: true, generated: false, reason: "blocked_unpublished" };
    }

    const generated = await generatePRFromFacts({ force: false });
    if (!generated.ok) return { ok: false, error: generated.error };

    return {
      ok: true,
      generated: true,
      id: generated.id,
      title: generated.title,
      slug: generated.slug,
      complianceStatus: generated.complianceStatus,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "scheduled PR generation failed" };
  }
}

async function loadActiveFacts(): Promise<PRFactInput[]> {
  const admin = createAdminClient();
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

async function uniqueSlug(base: string): Promise<string> {
  const admin = createAdminClient();
  const root = slugify(base) || "press-release";
  let candidate = root;
  for (let i = 1; i <= 50; i += 1) {
    const { data } = await admin.from("press_releases").select("id").eq("slug", candidate).maybeSingle();
    if (!data?.id) return candidate;
    candidate = `${root}-${i + 1}`;
  }
  return `${root}-${Date.now()}`;
}

async function unresolvedExists(campaignId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("press_releases")
    .select("id")
    .eq("campaign_id", campaignId)
    .in("status", ["draft", "reviewed", "approved"])
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

function defaultTopicFromFacts(facts: PRFactInput[]): string {
  const top = facts.slice(0, 4).map((f) => f.title).filter(Boolean);
  if (!top.length) return "Innvil platform update";
  return `Innvil update: ${top.join(" + ")}`;
}

export async function generatePRFromFacts(input?: {
  topic?: string;
  force?: boolean;
}): Promise<GeneratePROutcome> {
  const admin = createAdminClient();
  const campaign = await getOrCreateDefaultCampaign();

  if (!input?.force) {
    const blocked = await unresolvedExists(campaign.id);
    if (blocked) {
      return { ok: false, error: "There is already an unpublished PR (draft/reviewed/approved). Resolve it before generating another." };
    }
  }

  const facts = await loadActiveFacts();
  if (!facts.length) return { ok: false, error: "No active PR facts available. Add at least one fact first." };

  const topic = input?.topic?.trim() || defaultTopicFromFacts(facts);

  const draft = await generatePRDraft({ topic, facts });
  if (!draft.ok) return { ok: false, error: draft.error };

  const compliance = await runPRCompliance({
    title: draft.draft.title,
    summary: draft.draft.summary,
    body: draft.draft.body,
    facts,
  });

  const complianceStatus = compliance.ok ? compliance.report.status : "fail";
  const slug = await uniqueSlug(draft.draft.slug);

  const { data: inserted, error: insertErr } = await admin
    .from("press_releases")
    .insert({
      campaign_id: campaign.id,
      title: draft.draft.title,
      slug,
      summary: draft.draft.summary,
      body: draft.draft.body,
      status: "draft",
      source: "ai",
      topic,
      compliance_status: complianceStatus,
    })
    .select("id, title, slug")
    .single();

  if (insertErr || !inserted) return { ok: false, error: insertErr?.message ?? "Could not save generated PR." };

  if (draft.draft.claims.length) {
    await admin.from("pr_claim_sources").insert(
      draft.draft.claims.map((c) => ({
        press_release_id: inserted.id,
        claim_text: c.claimText,
        fact_library_id: c.factId,
        source_url: c.sourceUrl,
        confidence: c.confidence,
      }))
    );
  }

  if (compliance.ok) {
    await admin.from("pr_compliance_reports").insert({
      press_release_id: inserted.id,
      status: compliance.report.status,
      checks: compliance.report.checks,
      summary: compliance.report.summary,
      raw_feedback: compliance.report.rawFeedback,
    });
  } else {
    await admin.from("pr_compliance_reports").insert({
      press_release_id: inserted.id,
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

  const now = new Date();
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + Math.max(1, Number(campaign.interval_days || 30)));

  await admin
    .from("pr_campaigns")
    .update({
      last_generated_at: now.toISOString(),
      next_generation_date: next.toISOString().slice(0, 10),
    })
    .eq("id", campaign.id);

  return {
    ok: true,
    id: inserted.id,
    title: inserted.title,
    slug: inserted.slug,
    complianceStatus,
  };
}
