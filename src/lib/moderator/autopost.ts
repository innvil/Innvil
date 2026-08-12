/* =========================================================
   AI Telegram Auto-Posting — pure scheduling logic (Phase 4.N part B,
   docs/moderator/project-knowledge-autoposting-spec.md's "AUTO-POSTING
   UPDATE -- Per-Moderator Posting Windows" section). No I/O here — the
   DB-facing orchestration lives in autopost-runtime.ts.

   Each ModeratorDeployment may have one or more AutoPostWindow entries
   (community + assigned moderator + local start/end time). At most ONE
   successful publication per window per LOCAL community day (spec §3),
   at a RANDOM time generated once and persisted (spec §4/§5) — never
   re-rolled per cron tick.
   ========================================================= */

export interface AutoPostWindow {
  id: string;
  panelId: string;
  communityId: string;
  moderatorDeploymentId: string;
  startLocalTime: string; // "HH:MM"
  endLocalTime: string; // "HH:MM"
  enabled: boolean;
}

export type AutoPostOccurrenceStatus =
  | "scheduled" | "generating" | "generated" | "publishing" | "published" | "publish_failed" | "failed" | "missed" | "cancelled";

export interface AutoPostOccurrence {
  id: string;
  autoPostWindowId: string;
  localDate: string; // "YYYY-MM-DD"
  scheduledFor: string; // ISO
  status: AutoPostOccurrenceStatus;
  generatedTitle: string | null;
  generatedContent: string | null;
  publishedMessageId: string | null;
  publishedAt: string | null;
  error: string | null;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseLocalTime(value: string): { h: number; m: number } | null {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

function minutesOfDay(t: { h: number; m: number }): number {
  return t.h * 60 + t.m;
}

/** Rejects an invalid or overnight (end <= start) window — overnight
 *  windows are explicitly NOT supported this pass (spec §8's own sanctioned
 *  fallback: "if the existing scheduler cannot safely support this yet,
 *  reject rather than implementing ambiguous behavior") rather than
 *  attempting midnight-crossing arithmetic. */
export function validateWindow(startLocalTime: string, endLocalTime: string): { ok: true } | { ok: false; error: string } {
  const start = parseLocalTime(startLocalTime);
  const end = parseLocalTime(endLocalTime);
  if (!start) return { ok: false, error: `Invalid start time "${startLocalTime}" -- use 24h HH:MM.` };
  if (!end) return { ok: false, error: `Invalid end time "${endLocalTime}" -- use 24h HH:MM.` };
  if (minutesOfDay(end) <= minutesOfDay(start)) {
    return { ok: false, error: "End time must be after start time -- overnight windows (e.g. 22:00-02:00) aren't supported yet." };
  }
  return { ok: true };
}

/** The community's local calendar date for `now`, per its configured IANA
 *  timezone (falls back to "UTC" for an unset/invalid zone rather than
 *  throwing -- a malformed timezone must never crash the scheduler). */
export function localDateKeyInTimezone(now: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(now); // en-CA formats as YYYY-MM-DD
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

/** Converts a wall-clock local time (given as a "YYYY-MM-DD" date key +
 *  hour/minute) IN a specific IANA timezone to the real UTC instant it
 *  represents. Standard technique: interpret the wall-clock numbers as if
 *  they were already UTC (a "guess"), read what that guess-instant actually
 *  looks like when formatted in the target zone, and correct by the
 *  difference. Not exact across a DST transition instant itself (a v1
 *  simplification, not worth a full timezone library for this feature) --
 *  acceptable since posting is inherently approximate ("sometime in this
 *  window"), not a precision-critical instant. */
export function zonedTimeToUtc(localDateKey: string, h: number, m: number, timezone: string): Date {
  const [y, mo, d] = localDateKey.split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  let zone = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = fmt.formatToParts(guess).reduce((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  const hour24 = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const readAsLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour24, Number(parts.minute), Number(parts.second));
  const offsetMs = readAsLocal - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/** Picks a uniformly random minute within [start, end) for the given local
 *  day and converts it to a real UTC instant -- generated ONCE per
 *  occurrence and persisted by the caller (spec §4/§5), never recomputed. */
export function randomScheduledFor(localDateKey: string, startLocalTime: string, endLocalTime: string, timezone: string, random: () => number = Math.random): Date {
  const start = parseLocalTime(startLocalTime)!;
  const end = parseLocalTime(endLocalTime)!;
  const startMin = minutesOfDay(start);
  const endMin = minutesOfDay(end);
  const offset = Math.floor(random() * (endMin - startMin));
  const target = startMin + offset;
  return zonedTimeToUtc(localDateKey, Math.floor(target / 60), target % 60, timezone);
}

/** True once the window's END for this local day has passed relative to
 *  `now` -- used both to decide "don't bother creating today's occurrence,
 *  it's already too late" and "this scheduled-but-never-executed occurrence
 *  was MISSED, skip it rather than posting late" (spec §16). */
export function isWindowPastForToday(localDateKey: string, endLocalTime: string, timezone: string, now: Date): boolean {
  const end = parseLocalTime(endLocalTime)!;
  const windowEndUtc = zonedTimeToUtc(localDateKey, end.h, end.m, timezone);
  return now.getTime() >= windowEndUtc.getTime();
}

/** Bounded re-roll so two windows in the same community don't land within
 *  `minGapMinutes` of each other (spec §9's own worked example: Mika 10:51 /
 *  Kaleb 10:58 should NOT both fire seven minutes apart). A deliberately
 *  simple policy, not a full collision-resolution scheduler -- re-rolls up
 *  to `maxAttempts` times within the SAME window bounds, and accepts
 *  whatever the last attempt lands on if it still can't find a clear slot
 *  (documented limitation, not a hard guarantee for a very packed day). */
export function scheduleWithSpacing(
  localDateKey: string,
  startLocalTime: string,
  endLocalTime: string,
  timezone: string,
  otherScheduledTimes: Date[],
  random: () => number = Math.random,
  minGapMinutes = 10,
  maxAttempts = 5
): Date {
  let candidate = randomScheduledFor(localDateKey, startLocalTime, endLocalTime, timezone, random);
  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    const tooClose = otherScheduledTimes.some((t) => Math.abs(t.getTime() - candidate.getTime()) < minGapMinutes * 60_000);
    if (!tooClose) return candidate;
    candidate = randomScheduledFor(localDateKey, startLocalTime, endLocalTime, timezone, random);
  }
  return candidate;
}

/** Recent-content duplicate guard (spec §17/§21 base spec, §12 update
 *  section) — keyword-overlap heuristic, consistent with
 *  moderator/knowledge.ts's retrieval scoring (no semantic/embedding
 *  infrastructure exists in this codebase — see that file's header for the
 *  same reasoning). Community-WIDE, not per-moderator (spec §21: Kaleb
 *  should not repeat what Mika already posted). Returns true when the
 *  candidate is too similar to ANY recent post text. */
export function isTooSimilarToRecent(candidate: string, recentTexts: string[], overlapThreshold = 0.6): boolean {
  const candidateTokens = tokenizeForSimilarity(candidate);
  if (candidateTokens.size === 0) return false;
  for (const recent of recentTexts) {
    const recentTokens = tokenizeForSimilarity(recent);
    if (recentTokens.size === 0) continue;
    let overlap = 0;
    for (const t of candidateTokens) if (recentTokens.has(t)) overlap++;
    const ratio = overlap / Math.min(candidateTokens.size, recentTokens.size);
    if (ratio >= overlapThreshold) return true;
  }
  return false;
}

/** Human-safe output validation before publishing (spec §19) — bounded,
 *  cheap checks only (non-empty, within Telegram's length limit, no obvious
 *  placeholder/leaked-instruction text, no secret-shaped strings). Not a
 *  substitute for the generation prompt's own grounding rules — this is a
 *  last-resort guard against a malformed/leaked response reaching Telegram. */
export function validateGeneratedPost(text: string): { ok: true } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Empty generated content." };
  if (trimmed.length > 4096) return { ok: false, error: "Generated content exceeds Telegram's message length limit." };
  if (/\[insert|\bTODO\b|<placeholder>|\{\{.*\}\}/i.test(trimmed)) return { ok: false, error: "Generated content contains placeholder text." };
  if (/INSUFFICIENT_KNOWLEDGE|^TITLE:|^POST:/i.test(trimmed)) return { ok: false, error: "Generated content leaked internal formatting/sentinel text." };
  if (/\b(sk-[a-zA-Z0-9]{10,}|xox[baprs]-[a-zA-Z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b/.test(trimmed)) {
    return { ok: false, error: "Generated content appears to contain a secret." };
  }
  return { ok: true };
}

function tokenizeForSimilarity(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3)
  );
}
