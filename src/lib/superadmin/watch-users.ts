export interface WatchUser {
  id: string; displayName: string | null; email: string | null; registeredAt: string;
  emailConfirmed: boolean; firstWatchAt: string; discovery: "signup" | "activity";
  telegramVerified: boolean; subscriptionStatus: string | null; tier: string | null;
  manualGrant: boolean; periodEnd: string | null; trialEndsAt: string | null; watcherCount: number;
  accessStatus: "subscription" | "trial" | "expired" | "cancelled" | "inactive" | "onboarding";
}
export interface WatchUsersData {
  users: WatchUser[]; total: number;
  summary: { total: number; new7Days: number; new30Days: number; activeSubscriptions: number; activeTrials: number };
}
export interface WatchUsersQuery { search?: string; page?: number; recentDays?: number }
export type WatchUsersResult = { ok: true; data: WatchUsersData } | { ok: false; error: string };
export const WATCH_USERS_PAGE_SIZE = 25;
export function normalizeWatchUsersQuery(input: WatchUsersQuery = {}) {
  if (!input || typeof input !== "object") input = {};
  return { search: typeof input.search === "string" ? input.search.trim().slice(0, 120) : "",
    page: Number.isFinite(input.page) ? Math.max(1, Math.min(100000, Math.floor(input.page!))) : 1,
    recentDays: input.recentDays === 7 || input.recentDays === 30 ? input.recentDays : 0 };
}
export function watchUserStatus(user: Pick<WatchUser, "accessStatus" | "manualGrant">): string {
  if (user.accessStatus === "subscription") return user.manualGrant ? "Active · manual grant" : "Active direct subscription";
  return { trial: "Active trial", expired: "Direct access expired", cancelled: "Direct subscription cancelled", inactive: "Direct subscription inactive", onboarding: "No active direct subscription/trial" }[user.accessStatus];
}
