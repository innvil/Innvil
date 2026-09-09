"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { loadWatchUsersForActor } from "@/src/lib/superadmin/watch-users-server";
import type { WatchUsersQuery, WatchUsersResult } from "@/src/lib/superadmin/watch-users";

export async function listWatchUsersForSuperAdmin(input: WatchUsersQuery = {}): Promise<WatchUsersResult> {
  const { user, admin } = await getAuthedAdmin();
  return loadWatchUsersForActor(admin, user?.id ?? null, input);
}
