import "server-only";

import type { MediaClassificationResult } from "./media-moderation";

/* =========================================================
   Sightengine adapter — the FIRST real vendor wired behind
   media-safety-provider.ts's vendor-neutral contract. Sightengine-specific
   request/response shape is normalized ENTIRELY inside this file; nothing
   outside media-safety-provider.ts's dispatcher and this file knows
   Sightengine exists.

   Endpoint + model chosen from Sightengine's current official nudity
   detection docs (sightengine.com/docs — "Nudity Detection" +
   "Nudity & Suggestive (model 2.1)") at implementation time:
     POST https://api.sightengine.com/1.0/check.json
     multipart fields: media, models=nudity-2.1, api_user, api_secret

   Response shape (nudity-2.1): a `nudity` object with per-class
   PROBABILITIES in [0,1] (higher = more likely that class applies):
     sexual_activity   -- actual/simulated sexual activity w/ exposed nudity
     sexual_display    -- explicit exposure of genitals/sexual organs
     erotica           -- exposure of breasts/buttocks/pubic region
     very_suggestive   -- high suggestiveness, no visible sexual body parts
     suggestive        -- lower suggestiveness (incl. art/schematic nudity)
     mildly_suggestive -- low-level suggestiveness
     none              -- no suggestive/explicit content
   Sightengine also returns a nested `suggestive_classes` breakdown
   (bikini/lingerie/swimwear/male_chest/etc.) and a `context` object
   (sea_lake_pool/outdoor_other/indoor_other). This adapter deliberately
   does NOT read either of those: ordinary swimwear/beach/fitness/shirtless
   photos score LOW on sexual_activity/sexual_display/erotica by
   construction (that's what those specific classes exist to distinguish),
   so the false-positive protection required for beach/fitness/medical
   imagery already falls out of using the right classes at the right
   thresholds below -- reading the context field too would be extra
   complexity without changing any of the required test outcomes. Documented
   here as a deliberate v1 simplification, not an oversight.

   Authentication is api_user + api_secret (Sightengine's own scheme, not a
   bearer token) -- read ONLY server-side from SIGHTENGINE_API_USER /
   SIGHTENGINE_API_SECRET. Never logged, never included in thrown/user-
   visible errors, never sent to the browser.
   ========================================================= */

const SIGHTENGINE_ENDPOINT = "https://api.sightengine.com/1.0/check.json";
const SIGHTENGINE_MODEL = "nudity-2.1";
const DEFAULT_TIMEOUT_MS = 10_000;

// Named, documented thresholds -- deliberately conservative (spec: "initial
// policy should be conservative", "do not use skin visible as equivalent to
// pornography"). Chosen from Sightengine's OWN class semantics (see header),
// not invented arbitrarily. `EXPLICIT_HIGH` requires the classifier to be
// genuinely confident about an explicit-sexual-activity/display class before
// this can ever reach an immediate high-confidence enforcement action.
const SIGHTENGINE_EXPLICIT_HIGH = 0.9; // sexual_activity/sexual_display >= this -> explicit/high (immediate DELETE_BAN-eligible)
const SIGHTENGINE_EXPLICIT_MEDIUM = 0.6; // sexual_activity/sexual_display/erotica >= this (below HIGH) -> explicit/medium (borderline warn/escalate path)
const SIGHTENGINE_UNCERTAIN_HIGH = 0.55; // erotica/very_suggestive >= this -> uncertain/high (also borderline warn/escalate path)
const SIGHTENGINE_UNCERTAIN_LOW = 0.3; // erotica/very_suggestive/suggestive >= this -> uncertain/medium (ALLOW, logged only)

export interface SightengineNudityClasses {
  sexual_activity?: number;
  sexual_display?: number;
  erotica?: number;
  very_suggestive?: number;
  suggestive?: number;
  mildly_suggestive?: number;
  none?: number;
}

interface SightengineResponse {
  status?: string; // "success" | "failure"
  error?: { type?: string; code?: number; message?: string };
  nudity?: SightengineNudityClasses;
}

export function sightengineConfigured(): boolean {
  return !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);
}

/** Maps Sightengine's own probability classes onto Innvil's vendor-neutral
 *  {verdict, confidence} contract. Exported and pure (no I/O) so the mapping
 *  itself is directly unit-testable against a fixed response fixture,
 *  independent of the HTTP call around it. */
export function normalizeSightengineNudity(n: SightengineNudityClasses): MediaClassificationResult {
  const sexualHigh = Math.max(n.sexual_activity ?? 0, n.sexual_display ?? 0);
  const erotica = n.erotica ?? 0;
  const verySuggestive = n.very_suggestive ?? 0;
  const suggestive = n.suggestive ?? 0;

  if (sexualHigh >= SIGHTENGINE_EXPLICIT_HIGH) {
    return { ok: true, verdict: "explicit", confidence: "high", reason: "sightengine_sexual_activity_or_display" };
  }
  if (sexualHigh >= SIGHTENGINE_EXPLICIT_MEDIUM || erotica >= SIGHTENGINE_EXPLICIT_MEDIUM) {
    return { ok: true, verdict: "explicit", confidence: "medium", reason: "sightengine_moderate_explicit_signal" };
  }
  if (erotica >= SIGHTENGINE_UNCERTAIN_HIGH || verySuggestive >= SIGHTENGINE_UNCERTAIN_HIGH) {
    return { ok: true, verdict: "uncertain", confidence: "high", reason: "sightengine_high_suggestive_signal" };
  }
  if (erotica >= SIGHTENGINE_UNCERTAIN_LOW || verySuggestive >= SIGHTENGINE_UNCERTAIN_LOW || suggestive >= SIGHTENGINE_EXPLICIT_MEDIUM) {
    return { ok: true, verdict: "uncertain", confidence: "medium", reason: "sightengine_moderate_suggestive_signal" };
  }
  return { ok: true, verdict: "safe", confidence: "high", reason: "sightengine_no_significant_signal" };
}

/** Classifies a single still image (or video frame) via Sightengine's
 *  nudity-2.1 model. Returns a FAILURE — never a fabricated verdict — for:
 *  unconfigured credentials, auth rejection (401/403 or Sightengine's own
 *  credential error envelope), rate-limit/quota rejection (429 or
 *  Sightengine's own quota error envelope), any other non-2xx, timeout,
 *  malformed/non-JSON response, or a response missing the expected
 *  `nudity` classification object. */
export async function classifyImageBytesViaSightengine(bytes: Buffer, mimeType: string): Promise<MediaClassificationResult> {
  if (!sightengineConfigured()) return { ok: false, failure: "provider_unconfigured" };

  const apiUser = process.env.SIGHTENGINE_API_USER!;
  const apiSecret = process.env.SIGHTENGINE_API_SECRET!;
  const timeoutMs = Number(process.env.MEDIA_SAFETY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(bytes)], { type: mimeType || "image/jpeg" }), "frame.jpg");
  form.append("models", SIGHTENGINE_MODEL);
  form.append("api_user", apiUser);
  form.append("api_secret", apiSecret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(SIGHTENGINE_ENDPOINT, { method: "POST", body: form, signal: controller.signal });

    if (res.status === 401 || res.status === 403) {
      logMediaSafety({ verdict: "provider_auth_failed", durationMs: Date.now() - startedAt, httpStatus: res.status });
      return { ok: false, failure: "provider_auth_failed" };
    }
    if (res.status === 429) {
      logMediaSafety({ verdict: "provider_rate_limited", durationMs: Date.now() - startedAt, httpStatus: res.status });
      return { ok: false, failure: "provider_rate_limited" };
    }
    if (!res.ok) {
      logMediaSafety({ verdict: "provider_error", durationMs: Date.now() - startedAt, httpStatus: res.status });
      return { ok: false, failure: "provider_error" };
    }

    let data: SightengineResponse;
    try {
      data = (await res.json()) as SightengineResponse;
    } catch {
      logMediaSafety({ verdict: "provider_error", durationMs: Date.now() - startedAt, reason: "malformed_json" });
      return { ok: false, failure: "provider_error" };
    }

    if (data.status === "failure") {
      const type = (data.error?.type ?? "").toLowerCase();
      const message = (data.error?.message ?? "").toLowerCase();
      const failure = /credential|auth|access_denied/.test(type) || /credential|auth/.test(message)
        ? "provider_auth_failed"
        : /quota|limit|usage/.test(type) || /quota|limit|usage/.test(message)
        ? "provider_rate_limited"
        : "provider_error";
      logMediaSafety({ verdict: failure, durationMs: Date.now() - startedAt, reason: data.error?.type ?? "unknown" });
      return { ok: false, failure };
    }

    if (!data.nudity) {
      logMediaSafety({ verdict: "provider_error", durationMs: Date.now() - startedAt, reason: "missing_nudity_fields" });
      return { ok: false, failure: "provider_error" };
    }

    const result = normalizeSightengineNudity(data.nudity);
    logMediaSafety({
      verdict: result.ok ? result.verdict : result.failure,
      confidence: result.ok ? result.confidence : undefined,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    logMediaSafety({ verdict: timedOut ? "provider_timeout" : "provider_error", durationMs: Date.now() - startedAt });
    return { ok: false, failure: timedOut ? "provider_timeout" : "provider_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Structured, secret-free telemetry — enough to diagnose provider health
 *  (SAFE vs EXPLICIT vs UNCERTAIN vs each PROVIDER_FAILURE class) without a
 *  new monitoring platform, same `[tag] JSON.stringify({...})` convention
 *  already used by `[ai-usage]` in src/lib/ai/client.ts. Never logs the
 *  api_user/api_secret, the request body, or the image/frame bytes. */
function logMediaSafety(fields: { verdict: string; confidence?: string; durationMs: number; httpStatus?: number; reason?: string }): void {
  console.log("[media-safety]", JSON.stringify({ provider: "sightengine", ...fields }));
}
