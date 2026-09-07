import "server-only";

import type { MediaClassificationResult } from "./media-moderation";
import { classifyImageBytesViaSightengine } from "./sightengine-provider";

/* =========================================================
   Visual safety classification — the I/O half of media moderation, kept
   separate from media-moderation.ts (pure policy/no I/O), mirroring the
   existing link-classify.ts / link-moderation.ts split.

   This is a vendor-neutral DISPATCHER, not a hardcoded vendor integration:
   the rest of Innvil calls `classifyImageBytes` and never needs to know
   which concrete NSFW-classification vendor is behind it. Vendor selection
   is `MEDIA_SAFETY_PROVIDER` (currently only `"sightengine"` is a real,
   wired implementation — see sightengine-provider.ts, which normalizes
   Sightengine's own response shape entirely internally). Unset/anything
   else falls back to the original generic HTTP contract below (a small
   proxy-shaped adapter kept for local testing / a future second vendor —
   NOT wired to any specific vendor). This is a SPECIALIZED VISUAL
   CLASSIFIER, never Innvil's own conversational AI (DeepSeek/Claude chat
   routing) -- media moderation must never depend on or be confused with
   that path.

   Required environment variables (undocumented/unset = provider treated as
   unconfigured, which is a FAILURE state that always resolves to ALLOW at
   the policy layer -- never silently "explicit"):
     MEDIA_SAFETY_PROVIDER          -- "sightengine" to use the real adapter
     SIGHTENGINE_API_USER           -- Sightengine credential (server-only)
     SIGHTENGINE_API_SECRET         -- Sightengine credential (server-only)
     MEDIA_SAFETY_TIMEOUT_MS        -- optional, default 10000, shared by every adapter
   Legacy generic adapter (used only when MEDIA_SAFETY_PROVIDER is unset):
     MEDIA_SAFETY_PROVIDER_URL      -- POST endpoint accepting image bytes
     MEDIA_SAFETY_PROVIDER_API_KEY  -- bearer token for that endpoint
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

/** Classifies a single still image (or a sampled video frame — the caller
 *  never distinguishes the two, per the "media classification happens at
 *  the image level" architecture). Dispatches on `MEDIA_SAFETY_PROVIDER`;
 *  returns a FAILURE (never a fabricated verdict) for: unconfigured
 *  provider, network/HTTP error, timeout, or a malformed response — the
 *  policy layer (media-moderation.ts's decideMediaEnforcement) always
 *  resolves any failure to ALLOW regardless of which adapter produced it. */
export async function classifyImageBytes(bytes: Buffer, mimeType: string): Promise<MediaClassificationResult> {
  if (process.env.MEDIA_SAFETY_PROVIDER === "sightengine") {
    return classifyImageBytesViaSightengine(bytes, mimeType);
  }

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
