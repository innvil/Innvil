import "server-only";

import type { MediaClassificationResult } from "./media-moderation";

/* =========================================================
   Visual safety classification — the I/O half of media moderation, kept
   separate from media-moderation.ts (pure policy/no I/O), mirroring the
   existing link-classify.ts / link-moderation.ts split.

   No image-safety/NSFW provider or dependency exists anywhere in this
   codebase (checked before writing this file — no such package.json
   dependency, no existing vision/moderation client). This is deliberately a
   REPLACEABLE ADAPTER, not a hardcoded vendor integration: it speaks one
   small, generic HTTP contract (send image bytes, get back a verdict +
   confidence) so it can be pointed at whichever concrete NSFW-classification
   vendor/service Innvil ultimately picks, without coupling the moderation
   pipeline itself to that choice. This is INTENTIONALLY NOT wired to any
   specific vendor yet -- see MEDIA_SAFETY_PROVIDER_URL below. This is a
   SPECIALIZED VISUAL CLASSIFIER, never Innvil's own conversational AI
   (DeepSeek/Claude chat routing) -- media moderation must never depend on
   or be confused with that path.

   Required environment variables (undocumented/unset = provider treated as
   unconfigured, which is a FAILURE state that always resolves to ALLOW at
   the policy layer -- never silently "explicit"):
     MEDIA_SAFETY_PROVIDER_URL      -- POST endpoint accepting image bytes
     MEDIA_SAFETY_PROVIDER_API_KEY  -- bearer token for that endpoint
     MEDIA_SAFETY_TIMEOUT_MS        -- optional, default 10000
   ========================================================= */

const DEFAULT_TIMEOUT_MS = 10_000;

function isConfigured(): boolean {
  return !!(process.env.MEDIA_SAFETY_PROVIDER_URL && process.env.MEDIA_SAFETY_PROVIDER_API_KEY);
}

/** Generic response contract any fronting adapter/proxy for a real vendor
 *  must produce: `{ verdict: "safe"|"uncertain"|"explicit", confidence:
 *  "low"|"medium"|"high", reason?: string }`. Vendor-specific response
 *  shapes get normalized into this contract inside whatever small proxy
 *  sits in front of MEDIA_SAFETY_PROVIDER_URL -- this file never assumes a
 *  specific vendor's raw response format. */
interface RawProviderResponse {
  verdict?: string;
  confidence?: string;
  reason?: string;
}

const VALID_VERDICTS = new Set(["safe", "uncertain", "explicit"]);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);

/** Classifies a single still image. Returns a FAILURE (never a fabricated
 *  verdict) for: unconfigured provider, network/HTTP error, timeout, or a
 *  malformed response — the policy layer (media-moderation.ts's
 *  decideMediaEnforcement) always resolves any failure to ALLOW. */
export async function classifyImageBytes(bytes: Buffer, mimeType: string): Promise<MediaClassificationResult> {
  if (!isConfigured()) return { ok: false, failure: "provider_unconfigured" };

  const url = process.env.MEDIA_SAFETY_PROVIDER_URL!;
  const apiKey = process.env.MEDIA_SAFETY_PROVIDER_API_KEY!;
  const timeoutMs = Number(process.env.MEDIA_SAFETY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": mimeType || "application/octet-stream" },
      body: new Uint8Array(bytes),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, failure: "provider_error" };
    const data = (await res.json()) as RawProviderResponse;
    const verdict = (data.verdict ?? "").toLowerCase();
    const confidence = (data.confidence ?? "").toLowerCase();
    if (!VALID_VERDICTS.has(verdict) || !VALID_CONFIDENCE.has(confidence)) return { ok: false, failure: "provider_error" };
    return { ok: true, verdict: verdict as "safe" | "uncertain" | "explicit", confidence: confidence as "low" | "medium" | "high", reason: data.reason };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { ok: false, failure: "provider_timeout" };
    return { ok: false, failure: "provider_error" };
  } finally {
    clearTimeout(timer);
  }
}
