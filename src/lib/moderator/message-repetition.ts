type PriorMessage = { text: string; senderType: string; senderPlatformId?: string | null; createdAt?: string | null; replyToPlatformMessageId?: string | null };
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
export function isDmNudge(text: string): boolean {
  return text.length <= 160 && !/https?:\/\//i.test(text) && /\b(?:check|read|see)\s+(?:(?:your|my|the)\s+)?(?:dm|dms|pm|inbox)\b/i.test(text);
}
function priorCopies(text: string, senderId: string, context: PriorMessage[], now: Date, windowMs: number): number {
  const key = normalize(text);
  return context.filter(m => m.senderType === "HUMAN" && m.senderPlatformId === senderId && !m.replyToPlatformMessageId && m.createdAt
    && now.getTime() >= Date.parse(m.createdAt) && now.getTime() - Date.parse(m.createdAt) < windowMs && normalize(m.text) === key).length;
}
export function isRepeatedDmNudge(text: string, senderId: string, context: PriorMessage[], now: Date, isReply = false): boolean {
  return !isReply && isDmNudge(text) && priorCopies(text, senderId, context, now, 5 * 60_000) >= 2;
}
export function isRapidMessageFlood(text: string, senderId: string, context: PriorMessage[], now: Date, isReply = false): boolean {
  return !isReply && !isDmNudge(text) && priorCopies(text, senderId, context, now, 30_000) >= 3;
}
