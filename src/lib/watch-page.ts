import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isWatchHost } from "@/src/lib/watch-host";
import { getAuthedAdmin } from "@/src/lib/auth";
import { hasProductAccess } from "@/src/lib/products/ownership";
import { WATCH_PRODUCT_SLUG } from "@/src/lib/products/watch";
import { getAccountCapacity, listAccountAttentionItems, type AccountCapacity } from "@/src/lib/products/watch-runtime";

/**
 * Shared guard for every real Watch feature route (`/projects`,
 * `/communities`, `/watchers`, `/activity`, `/usage`, `/billing`,
 * `/settings`) — avoids repeating host/auth/entitlement checks 7+ times.
 * These bare paths don't exist anywhere in the main Innvil/Forge app
 * (confirmed: no file-based route uses them, the owner app is a client-side
 * SPA with internal section state, not real URLs), so this is safe on any
 * host, but still explicitly redirects non-Watch-host requests to "/" —
 * these routes are Watch-only, never a general app surface.
 */
export async function requireWatchPage(): Promise<{ accountId: string; admin: SupabaseClient }> {
  if (!(await isWatchHost())) redirect("/");
  const { user, admin } = await getAuthedAdmin();
  if (!user) redirect("/login");
  const entitled = await hasProductAccess(admin, user.id, WATCH_PRODUCT_SLUG);
  if (!entitled) redirect("/");
  return { accountId: user.id, admin };
}

/** Shared sidebar/topbar context (plan capacity + the "needs attention"
 *  count) every real Watch feature page passes into `WatchShell` — kept in
 *  one place so all 10+ pages agree on the same two numbers instead of each
 *  re-deriving them slightly differently. */
export async function getWatchShellContext(admin: SupabaseClient, accountId: string): Promise<{ capacity: AccountCapacity | null; attentionCount: number }> {
  const [capacity, attentionItems] = await Promise.all([
    getAccountCapacity(admin, accountId),
    listAccountAttentionItems(admin, accountId),
  ]);
  return { capacity, attentionCount: attentionItems.length };
}
