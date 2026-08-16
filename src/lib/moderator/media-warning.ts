import "server-only";

import { aiComplete, aiConfigured, getInnvilModelConfig } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";
import { PROMOTION_WARNING_LIMIT } from "./link-moderation";

/**
 * Persona-voiced warning line for BORDERLINE media-safety results (mirrors
 * link-classify.ts's generateModerationWarning exactly, kept in a separate
 * file only because the wording is specific to media rather than link spam
 * -- same hard INNVIL_REQUIRED_MODEL routing, same "never robotic wording"
 * requirement, same deterministic fallback pool so enforcement never
 * depends on this succeeding).
 */

const WARNING_FALLBACK_TEMPLATES = [
  "Hey, that media looks like it might not be appropriate for this group, so I've taken it down for now. Please keep uploads appropriate for the community.",
  "I removed that upload since it may not be appropriate here. If this keeps happening, I'll have to take further action.",
  "That doesn't look appropriate for this group, so I'm removing it. Please keep shared media appropriate going forward.",
];

export async function generateMediaModerationWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  warningNumber: number,
  isFinalWarning: boolean
): Promise<string> {
  if (aiConfigured()) {
    try {
      const { model, effort } = getInnvilModelConfig();
      const raw = await aiComplete({
        system: [
          `You are ${moderatorName}, a moderator in a Telegram community. You just removed a photo/video for possibly violating this community's content policy (borderline/uncertain explicit content).`,
          `Write ONE short, natural warning to the person, in your own voice (persona description: ${persona.description || "no specific persona configured — keep it plain and neutral"}).`,
          `This is warning #${warningNumber} of ${PROMOTION_WARNING_LIMIT}.`,
          isFinalWarning ? `This is their FINAL warning — make clear that the next violation results in removal from the community.` : `Keep it firm but not harsh — a normal warning, not a threat.`,
          `Do not describe the media in detail or repeat exactly what the content was. Never output "Violation ${warningNumber}/${PROMOTION_WARNING_LIMIT}" or similar robotic/templated wording — write like a real person would.`,
          `Respond with ONLY the message you'd actually send — no quotation marks, no explanation, under 30 words.`,
        ].join("\n"),
        messages: [{ role: "user", content: "Write the warning now." }],
        model,
        effort,
        maxTokens: 200,
        automation: "MEDIA_MODERATION_WARNING",
      });
      const text = raw.trim();
      if (text) return text.slice(0, 300);
    } catch {
      // fall through to the deterministic pool below
    }
  }
  return WARNING_FALLBACK_TEMPLATES[Math.min(warningNumber, WARNING_FALLBACK_TEMPLATES.length) - 1] ?? WARNING_FALLBACK_TEMPLATES[0];
}
