import "server-only";

import { aiComplete, aiConfigured, getInnvilModelConfig } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";
import {
  SPAM_WARNING_LIMIT,
  isNearDuplicateWarning,
  resolveWarningResponseMode,
  warningTextExceedsAuthorizedFacts,
  type WarningResponseMode,
} from "./link-moderation";
import { personaVoiceBlock } from "./chatter-generate";
import { byoProviderOverride, type AccountAiRouting } from "@/src/lib/products/watch-runtime";

/**
 * Persona-voiced warning line for BORDERLINE media-safety results (mirrors
 * link-classify.ts's generatePersonaSolicitationWarning exactly, kept in a
 * separate file only because the wording is specific to media rather than
 * link spam -- same hard INNVIL_REQUIRED_MODEL routing, same "never robotic
 * wording" requirement, same deterministic fallback pool so enforcement
 * never depends on this succeeding).
 *
 * BYO Enterprise (Phase 2, 2026-08-24): `aiRouting?.required` is checked
 * FIRST — when true, generation routes through the account's own stored
 * credential; `aiConfigured()`/Innvil's own key are never reached in that
 * branch. Any BYO failure falls straight to the same template pool.
 *
 * 2026-09-04, second pass -- this function previously only interpolated
 * `persona.description` as a bare string, the exact same bug pattern the
 * live-reported solicitation-warning issue was traced to. Fixed the same
 * way, mirroring link-classify.ts's generatePersonaSolicitationWarning:
 *  (1) the persona voice now reuses personaVoiceBlock (chatter-generate.ts)
 *  -- formality/slang/humor/teasing/emoji dials and customInstructions, not
 *  just the bare description sentence;
 *  (2) `recentOwnWarnings` (this SAME Watcher's own recent MODERATION
 *  WARNINGS in this SAME community, already scoped by the caller to exclude
 *  ordinary chatter -- see community-runtime.ts's recentOwnModeratorMessages)
 *  drives a single bounded anti-repetition retry, response-mode aware
 *  (resolveWarningResponseMode): the FINAL warning immediately before a kick
 *  is always an ENFORCEMENT_NOTICE and is never shortened even when it reads
 *  as a near-duplicate; a non-final warning with nothing further attached
 *  may become a brief SHORT_NUDGE on retry;
 *  (3) every generated candidate is passed through
 *  warningTextExceedsAuthorizedFacts before being returned -- media has no
 *  mute concept at all, so ANY stated minute-count is unsupported by
 *  definition, and a definite ban/kick/removal claim is likewise never
 *  supported by a WARN-tier notice (nothing has actually been removed yet).
 *  A candidate that fails is discarded in favor of the deterministic
 *  fallback pool, never "corrected" in place.
 */

const WARNING_FALLBACK_TEMPLATES = [
  "Hey, that media looks like it might not be appropriate for this group, so I've taken it down for now. Please keep uploads appropriate for the community.",
  "I removed that upload since it may not be appropriate here. If this keeps happening, I'll have to take further action.",
  "That doesn't look appropriate for this group, so I'm removing it. Please keep shared media appropriate going forward.",
];

function fallbackTemplateFor(warningNumber: number): string {
  return WARNING_FALLBACK_TEMPLATES[Math.min(warningNumber, WARNING_FALLBACK_TEMPLATES.length) - 1] ?? WARNING_FALLBACK_TEMPLATES[0];
}

const MAX_RECENT_WARNINGS_IN_PROMPT = 3;
const MAX_RECENT_WARNING_SNIPPET_CHARS = 140;

function stripMentionForPrompt(text: string): string {
  return text.replace(/<a\b[^>]*>.*?<\/a>/gi, "[name]").replace(/@[a-z0-9_]+/gi, "[name]");
}

/** Mode-aware retry instruction -- mirrors link-classify.ts's own
 *  buildAvoidRepeatingNote exactly (see its doc comment for the full
 *  reasoning). ENFORCEMENT_NOTICE (the final pre-kick warning) must still
 *  land its consequence in full; SHORT_NUDGE (any earlier, non-final
 *  warning) is explicitly told to go brief. */
function buildAvoidRepeatingNote(recentOwnWarnings: string[], mode: WarningResponseMode): string {
  const sample = recentOwnWarnings
    .slice(-MAX_RECENT_WARNINGS_IN_PROMPT)
    .map((t) => `"${stripMentionForPrompt(t).slice(0, MAX_RECENT_WARNING_SNIPPET_CHARS)}"`)
    .join(" / ");
  const lengthInstruction =
    mode === "ENFORCEMENT_NOTICE"
      ? "This is their FINAL warning before removal, so still make that consequence clear -- just phrase it differently, don't shorten it away."
      : "Since this keeps coming up, keep this one especially short -- a brief correction, not a full explanation.";
  return `You've said something VERY similar to this recently in this same room: ${sample}. Say THIS one differently -- change the opener, the sentence structure, and the closing line so it doesn't read like a repeat. ${lengthInstruction}`;
}

export async function generateMediaModerationWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  warningNumber: number,
  isFinalWarning: boolean,
  aiRouting?: AccountAiRouting,
  recentOwnWarnings: string[] = []
): Promise<string> {
  const buildSystem = (avoidRepeatingNote?: string): string =>
    [
      `You are ${moderatorName}, a moderator in a Telegram community. You just removed a photo/video for possibly violating this community's content policy (borderline/uncertain explicit content).`,
      `Write ONE short, natural warning to the person, entirely in your own persona voice (see below).`,
      ...personaVoiceBlock(persona),
      `This is warning #${warningNumber} of ${SPAM_WARNING_LIMIT}.`,
      isFinalWarning
        ? `This is their FINAL warning — make clear that the next violation results in removal from the community.`
        : `Keep it firm but not harsh — a normal warning, not a threat.`,
      `Do not describe the media in detail or repeat exactly what the content was. Never output "Violation ${warningNumber}/${SPAM_WARNING_LIMIT}" or similar robotic/templated wording — write like a real person would.`,
      avoidRepeatingNote,
      `Respond with ONLY the message you'd actually send — no quotation marks, no explanation, under 30 words.`,
    ]
      .filter((line): line is string => !!line)
      .join("\n");

  /** Returns the generated text, or null when generation genuinely could not
   *  happen (BYO required-but-unusable, no AI configured, or a failed
   *  call) -- null is the caller's signal to fall back to the deterministic
   *  template pool, preserving the prior branch-by-branch behavior. */
  const attemptGeneration = async (system: string): Promise<string | null> => {
    if (aiRouting?.required) {
      const cred = aiRouting.credential;
      if (!cred?.model) return null;
      try {
        const raw = await aiComplete({
          system,
          messages: [{ role: "user", content: "Write the warning now." }],
          model: cred.model,
          providerOverride: byoProviderOverride(cred),
          maxTokens: 200,
          automation: "MEDIA_MODERATION_WARNING_BYO",
        });
        const text = raw.trim();
        return text ? text.slice(0, 300) : null;
      } catch {
        return null;
      }
    }
    if (!aiConfigured()) return null;
    try {
      const { model, effort } = getInnvilModelConfig();
      const raw = await aiComplete({
        system,
        messages: [{ role: "user", content: "Write the warning now." }],
        model,
        effort,
        maxTokens: 200,
        automation: "MEDIA_MODERATION_WARNING",
      });
      const text = raw.trim();
      return text ? text.slice(0, 300) : null;
    } catch {
      return null;
    }
  };

  // Media has no mute concept at all -- any stated minute-count is
  // unsupported by construction, never authoritative.
  const sanitize = (candidate: string) => (warningTextExceedsAuthorizedFacts(candidate, { muteMinutes: null }) ? fallbackTemplateFor(warningNumber) : candidate);

  const first = await attemptGeneration(buildSystem());
  if (first === null) return fallbackTemplateFor(warningNumber);

  const isDuplicate = recentOwnWarnings.length > 0 && isNearDuplicateWarning(first, recentOwnWarnings);
  if (!isDuplicate) return sanitize(first);

  // Bounded to exactly ONE retry, response-mode aware -- see
  // buildAvoidRepeatingNote's own doc comment. The final pre-kick warning is
  // always ENFORCEMENT_NOTICE and is never shortened by this retry.
  const mode = resolveWarningResponseMode({ hasEnforcementConsequence: isFinalWarning, isNearDuplicateOfRecent: true });
  const retry = await attemptGeneration(buildSystem(buildAvoidRepeatingNote(recentOwnWarnings, mode)));
  return sanitize(retry ?? first);
}
