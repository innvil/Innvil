import "server-only";

import { aiComplete, deepseekChatterProvider } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";
import {
  SPAM_WARNING_LIMIT,
  maxWarningSimilarity,
  isStructurallyRepetitiveWarning,
  NEAR_DUPLICATE_WARNING_THRESHOLD,
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
 * link spam -- same "never robotic wording" requirement, same deterministic
 * fallback pool so enforcement never depends on this succeeding).
 *
 * MODEL ROUTING (revised 2026-09-06, explicit product decision): this is
 * presentation-layer output only -- the media-safety CLASSIFICATION and the
 * resulting delete/warn/kick decision have already happened deterministically
 * before this is ever called (see media-moderation.ts), and every candidate
 * is still checked against warningTextExceedsAuthorizedFacts before being
 * sent. Routes through the same cheap DeepSeek tier Natural Chatter's
 * CASUAL_CHAT already uses (deepseekChatterProvider()) rather than Sonnet 5.
 * Unconfigured/failed DeepSeek NEVER silently escalates to Sonnet -- it falls
 * straight to the deterministic fallback pool below, the same safe path a
 * missing AI key already produced before this change.
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
 *
 * 2026-09-04, third pass -- returns `string | null` now: `null` means
 * NO_PUBLIC_REPLY (a non-final warning whose candidate reads as near-
 * identical to something this Watcher just said -- nothing new to
 * communicate). `null` is NEVER returned as a result of generation FAILING
 * (a failed attempt always falls to the fallback pool, a real string) --
 * silence here is strictly a "nothing new to say" decision, never a symptom
 * of AI being down. The caller is responsible for skipping the SEND_TEXT/
 * insert entirely on `null` while running every other enforcement step
 * exactly as before.
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
): Promise<string | null> {
  const buildSystem = (avoidRepeatingNote?: string): string =>
    [
      `You are ${moderatorName} -- a real, familiar presence in this Telegram community, the same person who chats here normally. You are NOT a moderation system, a support agent, or a policy bot, and you must never sound like one.`,
      ...personaVoiceBlock(persona),
      `WHAT JUST HAPPENED: You removed a photo/video someone posted because it looked like it might not be appropriate for this group. That's already done.`,
      `You should not describe the media, or repeat what was in it.`,
      // AUTHORIZED facts, not required sentence content (2026-09-06) -- same
      // architecture correction as link-classify.ts's generators.
      `THINGS YOU'RE ALLOWED TO SAY -- all true; use whichever fit. Not a checklist, and you do not need to cover them all:`,
      `- Uploads here need to stay appropriate for the group.`,
      warningNumber > 1
        ? `- You've already had to say this to this same person before (this is time ${warningNumber}). You may let that show in how you say it -- shorter, less patient -- but you don't need to state the number, and counting out loud usually sounds automated.`
        : `- This looks like the first time for this person, so they may genuinely not have realized.`,
      isFinalWarning
        ? `- Doing it again means they're removed from the group. Don't quietly leave that out this time -- but say it the way you'd actually say it, not as a formal notice.`
        : `- Nothing else happened beyond removing the upload -- no mute, no kick, no ban. Never claim or imply otherwise.`,
      `Never state anything beyond that list -- no invented rule, punishment, or prior offense.`,
      avoidRepeatingNote,
      `Now: say the brief, natural thing YOU would actually say right now, having just done that -- not an announcement or a notice. Let the length fit the moment; often just a few words. Don't reach for the same opening you'd use every time. Respond with ONLY the message itself -- no quotes, no explanation.`,
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
    const deepseek = deepseekChatterProvider();
    if (!deepseek) return null;
    try {
      const raw = await aiComplete({
        system,
        messages: [{ role: "user", content: "Write the warning now." }],
        model: deepseek.model,
        providerOverride: { provider: deepseek.provider, apiKey: deepseek.apiKey, baseUrl: deepseek.baseUrl },
        disableThinking: true,
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

  // Response-mode resolution -- the final pre-kick warning is always
  // ENFORCEMENT_NOTICE, unconditionally, regardless of similarity; a
  // non-final warning's mode is driven by how similar this candidate
  // already is to something this Watcher recently said.
  const similarity = recentOwnWarnings.length ? maxWarningSimilarity(first, recentOwnWarnings) : 0;
  // Structural repetition (2026-09-06) -- same rationale as link-classify.ts's
  // own generators: catches "same skeleton, new synonyms."
  const structurallyRepetitive = recentOwnWarnings.length ? isStructurallyRepetitiveWarning(first, recentOwnWarnings) : false;
  const mode = resolveWarningResponseMode({ hasEnforcementConsequence: isFinalWarning, similarityToRecent: similarity });
  if (mode === "NO_PUBLIC_REPLY") return null;
  if (mode === "WARNING" && !structurallyRepetitive) return sanitize(first);
  // ENFORCEMENT_NOTICE is the mode whenever this is the final pre-kick
  // warning, REGARDLESS of similarity -- retry only when there's an ACTUAL
  // near-duplicate signal to react to (empty/no-match history forces
  // similarity to 0); a final warning with nothing recently similar has no
  // "sounds like a repeat" problem to solve, so it's returned as-is rather
  // than spending a wasted retry call.
  if (mode === "ENFORCEMENT_NOTICE" && similarity < NEAR_DUPLICATE_WARNING_THRESHOLD && !structurallyRepetitive) return sanitize(first);

  // SHORT_NUDGE or a genuinely-near-duplicate ENFORCEMENT_NOTICE: bounded to
  // exactly ONE retry, response-mode aware -- see buildAvoidRepeatingNote's
  // own doc comment.
  const retry = await attemptGeneration(buildSystem(buildAvoidRepeatingNote(recentOwnWarnings, mode)));
  return sanitize(retry ?? first);
}
