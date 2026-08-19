/**
 * Pure Watch first-run onboarding state machine (no I/O — the caller
 * gathers real account state and passes it in, see `getWatchAccessState`
 * in `actions/watch-dashboard.ts`). Governs ONLY the Overview welcome
 * panel for an account that hasn't reached a live deployment yet — once a
 * deployment is active ("operational"), the normal operational Overview
 * takes over and this state machine is no longer consulted.
 *
 * Telegram PERSON identity (Profile -> Connected identities -> Telegram)
 * is deliberately checked FIRST, before entitlement/trial/Project/
 * Community/Watcher -- a fresh standalone account's identity is
 * established before anything else, per explicit product decision. This
 * is the Telegram IDENTITY link (`watch_telegram_links`, one verified
 * person per account) -- never the Telegram COMMUNITY connection (a real
 * Telegram group/supergroup/channel, `communities` rows). The two are
 * never conflated here or anywhere else in this codebase.
 *
 * Real code-flow constraint, honestly reflected rather than papered over:
 * this codebase's actual UI has no standalone "connect a Community with no
 * Watcher yet" control -- Community connection only happens through
 * `WatcherConnectModal`, which bundles bot creation, Telegram membership
 * verification, Community connection, AND deployment into one guided flow
 * per Watcher. So the onboarding stages after "create a Watcher" collapse
 * Community-connect/deploy into a single "connect_watcher" stage instead
 * of two separate ones -- adapting the spec's step LABELS to what the real
 * code can actually do, per the explicit "adapt to current actual route/
 * business logic" instruction, rather than inventing a UI control that
 * doesn't exist.
 */

export type OnboardingStage =
  | "connect_telegram"
  | "try_watch"
  | "create_project"
  | "create_watcher"
  | "assign_moderation"
  | "connect_watcher"
  | "operational";

export interface OnboardingStateInput {
  telegramVerified: boolean;
  hasEntitlement: boolean;
  projectCount: number;
  watcherCount: number;
  /** True once at least one of this account's Watchers has an explicitly
   *  assigned persona (moderatorPersonaIsAssigned in domain.ts) -- a new
   *  Watcher is NEVER silently pre-assigned one from the account's
   *  Moderation Defaults (watch-runtime.ts's createAccountWatcher starts it
   *  genuinely blank), so this only ever becomes true from a real explicit
   *  action on the Persona tab. */
  watcherPersonaAssigned: boolean;
  activeDeploymentCount: number;
}

/** Resolves the single next onboarding stage from real account state --
 *  no duplicated completion flags, every input is directly derivable from
 *  existing canonical reads (Telegram identity, capacity, Project/Watcher/
 *  deployment counts). Checked in strict dependency order; the first
 *  unmet condition wins. */
export function resolveOnboardingStage(input: OnboardingStateInput): OnboardingStage {
  if (!input.telegramVerified) return "connect_telegram";
  if (!input.hasEntitlement) return "try_watch";
  if (input.projectCount === 0) return "create_project";
  if (input.watcherCount === 0) return "create_watcher";
  if (!input.watcherPersonaAssigned) return "assign_moderation";
  if (input.activeDeploymentCount === 0) return "connect_watcher";
  return "operational";
}

/** Ordered checklist for rendering — each item's `done` is derived from
 *  the SAME input the stage resolver uses, so the checklist and the
 *  resolved stage can never disagree. */
export interface OnboardingChecklistItem {
  key: Exclude<OnboardingStage, "operational">;
  label: string;
  done: boolean;
}

export function onboardingChecklist(input: OnboardingStateInput): OnboardingChecklistItem[] {
  return [
    { key: "connect_telegram", label: "Connect your Telegram account", done: input.telegramVerified },
    { key: "try_watch", label: "Try Innvil Watch", done: input.hasEntitlement },
    { key: "create_project", label: "Create a Project", done: input.projectCount > 0 },
    { key: "create_watcher", label: "Create a Watcher", done: input.watcherCount > 0 },
    { key: "assign_moderation", label: "Assign a moderation persona", done: input.watcherPersonaAssigned },
    { key: "connect_watcher", label: "Connect and deploy your Watcher", done: input.activeDeploymentCount > 0 },
  ];
}
