/** Participation permission, independent of moderation and knowledge. */
export function conversationSilenceReason(input: {
  text: string;
  explicitlyDirected: boolean;
  replyToOtherParticipant?: boolean;
  otherParticipantNames?: string[];
}): string | null {
  const text = input.text.trim();
  if (input.explicitlyDirected) return null;
  if (input.replyToOtherParticipant || /(?:^|\s)@[a-z0-9_]+\b/i.test(text)) return "addressed_to_other_participant";
  if (/\b(?:check|read|see|open)\s+(?:(?:your|my|the)\s+)?(?:dm|dms|pm|inbox)\b/i.test(text)) return "private_conversation_nudge";
  for (const name of input.otherParticipantNames ?? []) {
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped && new RegExp(`^(?:hey\\s+|hi\\s+)?${escaped}(?:[,!:]|\\s+(?:can|could|would|please|check)\\b)`, "i").test(text)) return "addressed_to_other_participant";
  }
  // A wish is not an implicit support question. Preserve actual requests,
  // including "I'd like to know how to buy" and "can you help me see ...?".
  const asksForHelp = /\?|\b(?:how|where|why|help|explain|tell me|show me|know|understand)\b/i.test(text);
  if (!asksForHelp && /\b(?:i(?:'d| would)?\s+(?:like|love|want)|i wish|i hope|hopefully)\b/i.test(text)
    && /\b(?:see|watch|hold|have|appear|show up)\b/i.test(text)) return "passive_wish_no_request";
  return null;
}
