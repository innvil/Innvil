/**
 * Watcher role separation + chatter rotation (pure, no I/O).
 *
 * Two independent concepts, deliberately kept separate:
 *   1. SPECIALIST ROLE  -- stable, deterministic responsibility assignment
 *      (Community Host / Knowledge Moderator / Spam & Scam Moderator /
 *      Media Safety Moderator / Rules & Conduct Moderator).
 *   2. CHATTER DUTY      -- a temporary, rotating eligibility state for
 *      ordinary casual/social conversation, capped at MAX_ACTIVE_CHATTERS.
 *
 * HARD OWNERSHIP INVARIANT: the domain that DETECTS a violation is the ONLY
 * domain that ever acts on it -- for both detection and every resulting
 * enforcement action (delete/warn/mute/kick/ban). Spam & Scam Moderator
 * owns spam/phishing/scam/unsolicited-promotion/malicious-link violations
 * end to end; Media Safety Moderator owns explicit/unsafe-media violations
 * end to end. There is NO cross-domain handoff of any kind -- severity of
 * the resulting punishment never changes who executes it, only the
 * violation's own source/type does. `resolveModerationEnforcer` is only
 * ever called with the SAME domain that detected the event; nothing in
 * this file (or its caller, community-runtime.ts) ever credits a
 * DIFFERENT domain for another domain's action. "Rules & Conduct
 * Moderator" is its own, separate domain for general conduct violations
 * NOT owned by Spam & Scam or Media Safety (harassment/disruptive
 * behavior, rule reminders, repeat-conduct tracking) -- it is not a
 * generic "executes punishment for everyone else" role, and its label was
 * chosen specifically so it can't be misread that way. It has no
 * dedicated detection pipeline of its own in this codebase today (an
 * honest, pre-existing, unrelated limitation -- only link/spam and media
 * moderation exist as real detectors right now), so at present it is a
 * real, named domain with nothing yet routed to it.
 *
 * Both are computed as PURE FUNCTIONS of (ordered deployment list, current
 * UTC time) -- nothing is persisted for this feature. This is a deliberate
 * architecture choice: it makes role stability across restarts, and role
 * redistribution on Watcher-count change, automatic and unbreakable by
 * construction (there is no stored value that can ever drift out of sync
 * with the real deployment set). Deployment ORDER (0-based "position",
 * matching the spec's W1/W2/.../W5 labeling) is `created_at` ascending, with
 * `deploymentId` as a final deterministic tiebreak -- never incidental
 * Postgres row order.
 *
 * Chatter rotation: `floor(nowUtcSeconds / CHATTER_ROTATION_WINDOW_SECONDS)`
 * is the window index. This is restart-safe and drift-free purely because
 * it's derived from wall-clock time, not a scheduler tick or persisted
 * counter. `chatterPairIndices` generates exactly the spec's own worked
 * rotation tables for 3/4/5 Watchers (adjacent-pair rotation: {k%N,(k+1)%N}),
 * and structurally can never return more than MAX_ACTIVE_CHATTERS (2)
 * entries for ANY count -- "do not use 3 active general chatters" is a
 * property of the function's return type, not a runtime check that could be
 * bypassed.
 *
 * Conversation continuity ("do not abruptly switch identity mid-exchange")
 * is handled by unioning the rotation pair with any deployment that's
 * currently mid an active exchange (wasLastSpeaker / recentlyParticipated,
 * both already computed per-candidate in community-runtime.ts) -- no new
 * "grace period" table is needed.
 */

export type ResponsibilityDomain = "host" | "knowledge" | "spam_scam" | "media_safety" | "rules_conduct";

export type ChatterDutyState = "ACTIVE_CHATTER" | "SPECIALIST_ONLY" | "DISABLED";

export interface WatcherRoleAssignment {
  deploymentId: string;
  /** Every specialist domain this deployment currently owns -- may combine
   *  multiple domains when the active Watcher count is below 5 (e.g.
   *  "Community Host + Knowledge Moderator" at 3-4 Watchers). Empty for a
   *  DISABLED (not currently enabled) deployment. */
  domains: ResponsibilityDomain[];
  /** Human-facing combined label, e.g. "Spam & Scam Moderator" or
   *  "Community Host + Knowledge Moderator". "Disabled" for a disabled
   *  deployment. */
  roleLabel: string;
  chatterDuty: ChatterDutyState;
}

export interface RoleableDeployment {
  deploymentId: string;
  /** ISO timestamp -- the sole source of stable, deterministic ordering.
   *  Never re-derived from anything else (never Postgres row order, which
   *  is not contractually guaranteed). */
  createdAt: string;
  /** Mirrors moderator_deployments.enabled. A disabled deployment is
   *  DISABLED and holds no domains and no chatter duty -- it is excluded
   *  from role/rotation math entirely, exactly like it's already excluded
   *  from every chatter/moderation query today (`.eq("enabled", true)`). */
  enabled: boolean;
}

/** 3 hours, matching the spec's own worked example exactly. */
export const CHATTER_ROTATION_WINDOW_SECONDS = 3 * 60 * 60;

/** Hard cap on simultaneous ACTIVE_CHATTER deployments, regardless of how
 *  many Watchers are deployed (a Community can hold up to 5). Enforced
 *  structurally by chatterPairIndices's own return shape, not just by this
 *  constant existing. */
export const MAX_ACTIVE_CHATTERS = 2;

const DOMAIN_LABELS: Record<ResponsibilityDomain, string> = {
  host: "Community Host",
  knowledge: "Knowledge Moderator",
  spam_scam: "Spam & Scam Moderator",
  media_safety: "Media Safety Moderator",
  rules_conduct: "Rules & Conduct Moderator",
};

/** Deterministic domain distribution, keyed strictly by (0-based order
 *  index, active Watcher count) -- never randomized, never reshuffled on
 *  restart: the same (index, count) always yields the same domains. Matches
 *  every one of the spec's 1..5-Watcher tables exactly. A Community can
 *  never exceed 5 active deployments (MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY),
 *  but count > 5 still resolves defensively via a clean 1:1 cyclic split
 *  rather than throwing. */
export function domainsForIndex(index: number, count: number): ResponsibilityDomain[] {
  if (count <= 0 || index < 0 || index >= count) return [];
  if (count === 1) return ["host", "knowledge", "spam_scam", "media_safety", "rules_conduct"];
  if (count === 2) return index === 0 ? ["host", "knowledge", "spam_scam"] : ["host", "media_safety", "rules_conduct"];
  if (count === 3) {
    if (index === 0) return ["host", "knowledge"];
    if (index === 1) return ["spam_scam"];
    return ["media_safety", "rules_conduct"];
  }
  if (count === 4) {
    if (index === 0) return ["host", "knowledge"];
    if (index === 1) return ["spam_scam"];
    if (index === 2) return ["media_safety"];
    return ["rules_conduct"];
  }
  // count >= 5 -- a clean 1:1 split, cycling defensively beyond 5 rather
  // than leaving a domain unassigned.
  const table: ResponsibilityDomain[] = ["host", "knowledge", "spam_scam", "media_safety", "rules_conduct"];
  return [table[index % table.length]];
}

export function roleLabelFor(domains: ResponsibilityDomain[]): string {
  if (!domains.length) return "Disabled";
  return domains.map((d) => DOMAIN_LABELS[d]).join(" + ");
}

/** The current 3-hour UTC rotation window index -- a pure function of wall
 *  clock time, so it survives restarts/redeploys/refreshes with zero
 *  persisted state and zero drift. */
export function chatterWindowIndex(nowMs: number): number {
  return Math.floor(nowMs / 1000 / CHATTER_ROTATION_WINDOW_SECONDS);
}

/** Which 0-based deployment indices hold ACTIVE_CHATTER duty in the given
 *  rotation window. count 1 -> always {0} (spec: "the only Watcher is
 *  always the chatter"). count 2 -> always {0,1} (spec: "both are always
 *  chatter-capable"). count >= 3 -> an adjacent pair that advances by one
 *  position every window ({0,1} -> {1,2} -> {2,3} -> ... -> {N-1,0} ->
 *  repeat), matching every one of the spec's worked 3/4/5-Watcher tables
 *  exactly -- one chatter always carries over (continuity), one rotates in. */
export function chatterPairIndices(count: number, windowIndex: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (count === 2) return [0, 1];
  const start = ((windowIndex % count) + count) % count; // safe for a negative windowIndex
  return [start, (start + 1) % count];
}

export interface AssignRolesOptions {
  now?: Date;
  /** Deployment ids currently mid an active exchange with a human (e.g.
   *  wasLastSpeaker/recentlyParticipated within the recent-context window)
   *  -- kept ACTIVE_CHATTER for continuity even when rotation has moved on,
   *  per the spec's explicit "do not abruptly switch identity mid-
   *  conversation" requirement. */
  continuityDeploymentIds?: Set<string>;
}

/** The single entry point: given every deployment in a Community (enabled
 *  or not) and the current time, returns each one's stable specialist
 *  role(s) and current chatter-duty state. Pure -- same input, same output,
 *  always; safe to call on every message with zero caching. */
export function assignWatcherRoles(deployments: RoleableDeployment[], options: AssignRolesOptions = {}): WatcherRoleAssignment[] {
  const now = options.now ?? new Date();
  const continuity = options.continuityDeploymentIds ?? new Set<string>();

  const active = deployments.filter((d) => d.enabled);
  const ordered = [...active].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    if (byTime !== 0) return byTime;
    return a.deploymentId.localeCompare(b.deploymentId);
  });
  const count = ordered.length;
  const windowIndex = chatterWindowIndex(now.getTime());
  const chatterIdxSet = new Set(chatterPairIndices(count, windowIndex));

  return deployments.map((d) => {
    if (!d.enabled) {
      return { deploymentId: d.deploymentId, domains: [], roleLabel: "Disabled", chatterDuty: "DISABLED" as const };
    }
    const idx = ordered.findIndex((o) => o.deploymentId === d.deploymentId);
    const domains = domainsForIndex(idx, count);
    const isRotationChatter = chatterIdxSet.has(idx);
    const isContinuity = continuity.has(d.deploymentId);
    const chatterDuty: ChatterDutyState = isRotationChatter || isContinuity ? "ACTIVE_CHATTER" : "SPECIALIST_ONLY";
    return { deploymentId: d.deploymentId, domains, roleLabel: roleLabelFor(domains), chatterDuty };
  });
}

/** The deployment currently holding a given specialist domain, or null if
 *  somehow none does (should not happen for count >= 1 -- every domain
 *  table above always assigns every domain to someone). */
export function deploymentForDomain(assignments: WatcherRoleAssignment[], domain: ResponsibilityDomain): string | null {
  const found = assignments.find((a) => a.domains.includes(domain));
  return found ? found.deploymentId : null;
}

export function activeChatterDeploymentIds(assignments: WatcherRoleAssignment[]): string[] {
  return assignments.filter((a) => a.chatterDuty === "ACTIVE_CHATTER").map((a) => a.deploymentId);
}

/** Resolves the moderation enforcer for a given specialist domain (spam_scam
 *  for link/phishing/scam moderation, media_safety for photo/video
 *  moderation) -- "Spam & Scam Moderator owns event" / "Media Safety
 *  Moderator owns event" (spec TEST 2/TEST 3), replacing the old arbitrary
 *  `deployments[0]` pick with a real, role-correct one. The caller MUST
 *  always pass the SAME domain that detected the event -- this function
 *  never routes an action to a different domain than the one that found
 *  it, and callers must never call it twice with different domains for
 *  ONE event to "hand off" enforcement (there is no such handoff; see the
 *  file's own header doc comment). Falls back to `deployments[0]`
 *  defensively if role resolution somehow comes back with no holder for
 *  the domain (should never happen for count >= 1, since domainsForIndex
 *  always assigns every domain to someone) -- this is the "specialist
 *  fallback" safety net, never silently drops moderation. */
export function resolveModerationEnforcer<T extends { deploymentId: string }>(
  deployments: T[],
  assignments: WatcherRoleAssignment[],
  domain: ResponsibilityDomain
): T {
  const targetId = deploymentForDomain(assignments, domain);
  return deployments.find((d) => d.deploymentId === targetId) ?? deployments[0];
}

/* ================================================================
   Post-selection ambient-pick reconciliation.

   selectChatterAction (chatter-coordinator.ts) is deliberately left
   UNTOUCHED by this feature -- it already picks one deployment per message
   via directed-mention -> continuity -> quietest-longest over the WHOLE
   eligible candidate pool. This function runs immediately after it, and
   only ever REPLACES the chosen deploymentId in two narrow, explicitly
   scoped cases:

     - CASUAL_CHAT / SHORT_ACK (ordinary ambient chatter): if the original
       pick was neither directed at that bot nor mid an active exchange
       (i.e. it was chosen purely by quietest-longest) AND it does not
       currently hold ACTIVE_CHATTER duty, re-pick restricted to the
       ACTIVE_CHATTER pool (continuity-first, then quietest-longest --
       the exact same tiebreak chatter-coordinator.ts itself uses, kept as
       a small intentional duplicate here rather than touching that file).

     - ANSWER (substantive/knowledge-shaped question): if the original pick
       was NOT directed at that bot and a DISTINCT deployment holds the
       "knowledge" domain, reassign to it -- the spec's explicit "Knowledge
       specialist may still answer... even if not one of the current
       chatter pair" carve-out.

   REACT and SILENCE pass through completely unchanged: reactions already
   use relevance-gated selection (a candidate must be wasLastSpeaker or
   recentlyParticipated to be picked at all), which is already reasonably
   scoped without needing a role overlay, and SILENCE has nothing to
   reconcile.

   A DIRECTED pick (isDirectedAtBot) is NEVER reassigned by this function,
   in either branch -- a human who explicitly named/replied-to a specific
   Watcher always keeps that Watcher's answer, regardless of its current
   role or chatter duty (see the plan's conflict-resolution #3). */

interface AmbientCandidateLike {
  deploymentId: string;
  isDirectedAtBot: boolean;
  wasLastSpeaker: boolean;
  recentlyParticipated: boolean;
  pacing: { lastSpokeAt: string | null };
}

interface AmbientActionLike {
  type: "SILENCE" | "REACT" | "SHORT_ACK" | "CASUAL_CHAT" | "ANSWER";
  deploymentId?: string;
  [key: string]: unknown;
}

function quietestLongestFirst<T extends AmbientCandidateLike>(pool: T[]): T | null {
  if (!pool.length) return null;
  const continuity = pool.find((c) => c.wasLastSpeaker);
  if (continuity) return continuity;
  return [...pool].sort((a, b) => {
    const aSpoke = a.pacing.lastSpokeAt ? new Date(a.pacing.lastSpokeAt).getTime() : 0;
    const bSpoke = b.pacing.lastSpokeAt ? new Date(b.pacing.lastSpokeAt).getTime() : 0;
    return aSpoke - bSpoke;
  })[0];
}

/** See the file-level doc comment above for the full behavioral contract. */
export function reconcileAmbientPick<TAction extends AmbientActionLike, TCandidate extends AmbientCandidateLike>(
  action: TAction,
  candidates: TCandidate[],
  assignments: WatcherRoleAssignment[]
): TAction {
  if (!action.deploymentId) return action;
  const pickedCandidate = candidates.find((c) => c.deploymentId === action.deploymentId);
  if (!pickedCandidate || pickedCandidate.isDirectedAtBot) return action; // directed picks are never reassigned

  const assignmentById = new Map(assignments.map((a) => [a.deploymentId, a]));

  if (action.type === "CASUAL_CHAT" || action.type === "SHORT_ACK") {
    const pickedDuty = assignmentById.get(action.deploymentId)?.chatterDuty;
    const isContinuity = pickedCandidate.wasLastSpeaker || pickedCandidate.recentlyParticipated;
    if (pickedDuty === "ACTIVE_CHATTER" || isContinuity) return action; // already eligible -- nothing to reconcile

    const chatterPool = candidates.filter((c) => assignmentById.get(c.deploymentId)?.chatterDuty === "ACTIVE_CHATTER");
    const replacement = quietestLongestFirst(chatterPool);
    if (!replacement || replacement.deploymentId === action.deploymentId) return action;
    return { ...action, deploymentId: replacement.deploymentId };
  }

  if (action.type === "ANSWER") {
    const knowledgeDeploymentId = deploymentForDomain(assignments, "knowledge");
    if (!knowledgeDeploymentId || knowledgeDeploymentId === action.deploymentId) return action;
    const knowledgeCandidate = candidates.find((c) => c.deploymentId === knowledgeDeploymentId);
    if (!knowledgeCandidate) return action; // defensive -- should always be present in `candidates`
    return { ...action, deploymentId: knowledgeDeploymentId };
  }

  return action; // REACT / SILENCE -- pass through unchanged
}
