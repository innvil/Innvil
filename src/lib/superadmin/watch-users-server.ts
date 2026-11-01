import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeWatchUsersQuery, WATCH_USERS_PAGE_SIZE, type WatchUsersQuery, type WatchUsersData, type WatchUsersResult } from "./watch-users";

/** Identity must come from server-validated getAuthedAdmin, never UI input. */
export async function loadWatchUsersForActor(admin: SupabaseClient, actorId: string | null, input: WatchUsersQuery = {}): Promise<WatchUsersResult> {
  if (!actorId) return { ok: false, error: "Super admin only." };
  const { data: profile, error: roleError } = await admin.from("profiles").select("role").eq("id", actorId).maybeSingle();
  if (roleError || profile?.role !== "super_admin") return { ok: false, error: "Super admin only." };
  const query = normalizeWatchUsersQuery(input);
  const { data, error } = await admin.rpc("superadmin_watch_users", {
    p_actor: actorId, p_search: query.search, p_page: query.page, p_page_size: WATCH_USERS_PAGE_SIZE, p_recent_days: query.recentDays,
  });
  if (error) return { ok: false, error: error.code === "PGRST202" || error.code === "42883"
    ? "Watch user reporting requires database migration 0130_superadmin_watch_users.sql."
    : "Could not load Watch users. Please retry." };
  if (!data || !Array.isArray(data.users) || !data.summary || typeof data.total !== "number") return { ok: false, error: "Invalid Watch user report response." };
  return { ok: true, data: data as WatchUsersData };
}
