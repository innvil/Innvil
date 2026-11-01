export type QuietSpamFamily = "promotion" | "competing_project" | "search_spam" | "dm_spam" | "token_contract_mismatch";
export interface QuietModerationClaim {
  claimed: true; stage: number; violationCount: number; action: "delete" | "mute" | "kick";
  muteMinutes: number | null; notice: "reminder" | "repeat" | "final" | null;
  suppressionReason: string | null; priorMuteAt: string | null; priorPublicWarningAt: string | null; heldForFinalWarning: boolean;
  priorPublicWarningCount: number;
}

/** This is a presentation/enforcement schedule, NEVER a content classifier. */
export function quietSpamFamily(reason: string, confirmedFlood: boolean): QuietSpamFamily | null {
  if (confirmedFlood) return null;
  const normalized = reason.replace(/^repeated_/, "");
  return ({ unsolicited_promotion: "promotion", competing_project_promotion: "competing_project", search_spam: "search_spam", dm_spam: "dm_spam", token_contract_mismatch: "token_contract_mismatch" } as Record<string, QuietSpamFamily>)[normalized] ?? null;
}

export function validQuietClaim(value: unknown): value is QuietModerationClaim {
  if (!value || typeof value !== "object") return false;
  const v = value as QuietModerationClaim;
  return v.claimed === true && Number.isInteger(v.stage) && v.stage >= 1 && v.stage <= 5
    && Number.isInteger(v.violationCount) && v.violationCount >= v.stage
    && ["delete", "mute", "kick"].includes(v.action)
    && (v.action === "mute" ? [10, 30, 60].includes(v.muteMinutes!) : v.muteMinutes === null)
    && Number.isInteger(v.priorPublicWarningCount) && v.priorPublicWarningCount >= 0
    && [null, "reminder", "repeat", "final"].includes(v.notice)
    && (v.action !== "kick" || (v.stage === 5 && v.heldForFinalWarning === false && v.notice === null))
    && (v.action !== "delete" || v.stage === 1)
    && (v.stage !== 2 || (v.action === "mute" && v.muteMinutes === 10 && v.notice === null));
}

export function quietNoticeNeedsMention(stage: number, targetIsClear: boolean): boolean {
  return stage >= 4 || (stage === 3 && !targetIsClear);
}

export function invalidQuietWarning(text: string, stage: number, priorMute: boolean): boolean {
  if (/@[a-z0-9_]+|\b(?:idiot|moron|stupid|dumb|thick inside)\b|\bwarning\s*#?\d/i.test(text)) return true;
  if (!priorMute && /\b(?:already|previously|before|earlier)\b.{0,35}\b(?:muted|timeout|time out)\b|\b(?:back|again)\b.{0,25}\b(?:mute|timeout|time out)\b|\b(?:muted|timeout|time out)\b.{0,35}\b(?:before|earlier|previously)\b|\bafter\s+(?:that|the|your)\s+(?:mute|timeout|time out)\b/i.test(text)) return true;
  if (stage >= 4 && (!/\b(?:last|final)\s+warning\b/i.test(text) || !/\b(?:again|another|next|one more)\b/i.test(text) || !/\b(?:removed|remove|kicked|kick)\b/i.test(text))) return true;
  return false;
}

export function quietWarningFallback(stage: number, family: QuietSpamFamily, destination: string | null, priorMute: boolean): string {
  if (stage >= 4) return "last warning—post this again and you'll be removed.";
  if (stage === 3) return priorMute ? "c’mon, the same spam again after that timeout? please stop." : "c’mon, please stop posting the same spam.";
  if (family === "token_contract_mismatch") return "please keep other token contracts out of here.";
  if (family === "competing_project") return "let’s keep this about our project, please.";
  if (family === "dm_spam") return "please stop the repeated DM nudges.";
  if (family === "search_spam") return "please stop posting that unrelated spam here.";
  return destination ? `keep the pitches in ${destination}, please.` : "please stop dropping sales pitches here.";
}
