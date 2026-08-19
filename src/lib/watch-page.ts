import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isWatchHost } from "@/src/lib/watch-host";
import { getAuthedAdmin } from "@/src/lib/auth";
import { getAccountCapacity, listAccountAttentionItems, type AccountCapacity } from "@/src/lib/products/watch-runtime";

/**
 * Shared guard for every real Watch feature route (`/projects`,
 * `/communities`, `/watchers`, `/activity`, `/usage`, `/billing`,
 * `/plans`, `/profile`, `/settings`, `/support`) — avoids repeating
 * host/auth checks 10+ times. These bare paths don't exist anywhere in the
 * main Innvil/Forge app (confirmed: no file-based route uses them, the
 * owner app is a client-side SPA with internal section state, not real
 * URLs), so this is safe on any host, but still explicitly redirects
 * non-Watch-host requests to "/" — these routes are Watch-only, never a
 * general app surface.
 *
 * AUTHENTICATION != ENTITLEMENT, deliberately. This guard checks only that
 * the visitor is on the Watch host and signed in — it does NOT require an
 * active trial/paid subscription/legacy Panel-based entitlement. A
 * brand-new Innvil account with zero Panels, zero entitlement, and zero
 * Watch resources must still be able to open every one of these pages (to
 * see empty states, reach Plans, start the Free Trial, or add Innvil
 * Credit) — that's the whole point of a standalone product. Every page
 * already resolves its OWN real entitlement state via `getAccountCapacity`
 * (returns `null` for "no entitlement", which every page already renders as
 * a real empty/upsell state, never a crash) and gates actual RESOURCE
 * CREATION (a new Project/Watcher/Community, a deployment) at the point of
 * the write itself (`requireAccountWatchContext` in watch-runtime.ts) —
 * this guard was previously ALSO redirecting on `!entitled`, which meant
 * every one of these pages, including `/plans` and `/billing` themselves,
 * was unreachable for a fresh, not-yet-entitled account (bounced back to
 * the marketing landing on every visit — a real, severe bug, not a design
 * choice). Fixed: this guard no longer touches entitlement at all.
 */
export async function requireWatchPage(): Promise<{ accountId: string; admin: SupabaseClient }> {
  if (!(await isWatchHost())) redirect("/");
  const { user, admin } = await getAuthedAdmin();
  if (!user) redirect("/login");
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
