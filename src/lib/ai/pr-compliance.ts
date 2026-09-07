import "server-only";

import { aiComplete, aiprimetechProvider } from "@/src/lib/ai/client";
import type { PRFactInput } from "@/src/lib/ai/pr-writer";

const PR_MODEL = process.env.BLOG_AI_MODEL || process.env.AI_MODEL || "claude-sonnet-5";

export interface PRComplianceReportDraft {
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
  rawFeedback: string;
}

export type PRComplianceResult =
  | { ok: true; report: PRComplianceReportDraft }
  | { ok: false; error: string };

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found in compliance response.");
  return JSON.parse(candidate.slice(start, end + 1));
}

function toArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, 20);
}

function validateReport(raw: unknown): PRComplianceResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Compliance output is not an object." };
  const obj = raw as {
    status?: unknown;
    summary?: unknown;
    checks?: unknown;
    rawFeedback?: unknown;
  };

  const status = obj.status === "pass" ? "pass" : obj.status === "fail" ? "fail" : null;
  if (!status) return { ok: false, error: "Compliance status is invalid." };

  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!summary) return { ok: false, error: "Compliance summary is missing." };

  const checksObj = obj.checks && typeof obj.checks === "object" ? obj.checks as Record<string, unknown> : {};
  const checks = {
    unsupportedClaims: toArray(checksObj.unsupportedClaims),
    fabricatedStatsOrAwards: toArray(checksObj.fabricatedStatsOrAwards),
    unverifiableQuotes: toArray(checksObj.unverifiableQuotes),
    promotionalToneRisks: toArray(checksObj.promotionalToneRisks),
    duplicateAngleRisks: toArray(checksObj.duplicateAngleRisks),
    keywordStuffingRisks: toArray(checksObj.keywordStuffingRisks),
  };

  const rawFeedback = typeof obj.rawFeedback === "string" ? obj.rawFeedback.trim() : "";

  return { ok: true, report: { status, summary, checks, rawFeedback } };
}

export async function runPRCompliance(input: {
  title: string;
  summary: string;
  body: Array<{ kind: string; text?: string; items?: string[] }>;
  facts: PRFactInput[];
}): Promise<PRComplianceResult> {
  const bodyText = input.body
    .map((b) => {
      if (b.kind === "ul" || b.kind === "ol") return `${b.kind.toUpperCase()}: ${(b.items ?? []).join(" | ")}`;
      return `${b.kind.toUpperCase()}: ${b.text ?? ""}`;
    })
    .join("\n");

  const factLines = input.facts
    .map((f) => `[${f.id}] ${f.title}: ${f.content}${f.sourceUrl ? ` (source: ${f.sourceUrl})` : ""}`)
    .join("\n");

  const providerOverride = aiprimetechProvider();
  const system = [
    "You are a strict PR compliance reviewer.",
    "Return JSON only.",
    "Evaluate if every claim is grounded by the supplied fact library.",
    "Fail if there are unsupported claims, fabricated numbers/awards/partnerships, unverifiable quotes, or deceptive promotional claims.",
  ].join(" ");

  const prompt = [
    "Press release draft:",
    `Title: ${input.title}`,
    `Summary: ${input.summary}`,
    bodyText,
    "",
    "Fact library:",
    factLines,
    "",
    "Return exactly this JSON shape:",
    "{",
    '  "status": "pass" | "fail",',
    '  "summary": "short explanation",',
    '  "checks": {',
    '    "unsupportedClaims": ["..."],',
    '    "fabricatedStatsOrAwards": ["..."],',
    '    "unverifiableQuotes": ["..."],',
    '    "promotionalToneRisks": ["..."],',
    '    "duplicateAngleRisks": ["..."],',
    '    "keywordStuffingRisks": ["..."]',
    "  },",
    '  "rawFeedback": "detailed reviewer notes"',
    "}",
    "",
    "Rules:",
    "- If a check has no issues, return an empty array for that check.",
    "- Set status='fail' when any high-risk issue exists.",
    "- Never include markdown fences.",
  ].join("\n");

  try {
    const text = await aiComplete({
      model: PR_MODEL,
      effort: "medium",
      maxTokens: 1400,
      requestTimeoutMs: 300_000,
      automation: "PR_COMPLIANCE_REVIEW",
      ...(providerOverride ? { providerOverride } : {}),
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = extractJson(text);
    return validateReport(parsed);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "PR compliance review failed." };
  }
}
