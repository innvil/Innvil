export function invalidWarningPresentation(text: string, audience: "individual" | "room", priorPublicWarning?: boolean): boolean {
  if (/\[(?:user|name|username|mention|member)[^\]]*\]|\{(?:user|name|username)\}|<[^>]+>/i.test(text)) return true;
  if (/\bi(?:['’]m| am) not\b/i.test(text)) return true;
  if (audience === "room" && /@[a-z0-9_]+|\byou(?:['’]re| are| have|['’]ve)\s+(?:muted|warned|banned|kicked)\b/i.test(text)) return true;
  if (priorPublicWarning === false && /\b(?:we['’]ve been over|we have been over|i (?:already )?told you|we (?:already )?told you|you['’]ve been warned|warned you before)\b/i.test(text)) return true;
  return false;
}

export function warningAudience(text: string, senderId: string, prior: Array<{ text: string; senderType: string; senderPlatformId?: string | null; createdAt?: string | null }>, now: Date): "individual" | "room" {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const key = normalize(text);
  const repeated = key.length >= 5 && prior.some(m => m.senderType === "HUMAN" && m.senderPlatformId && m.senderPlatformId !== senderId
    && m.createdAt && now.getTime() - Date.parse(m.createdAt) >= 0 && now.getTime() - Date.parse(m.createdAt) <= 120_000 && normalize(m.text) === key);
  return repeated ? "room" : "individual";
}
