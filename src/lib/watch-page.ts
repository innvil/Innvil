import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isWatchHost } from "@/src/lib/watch-host";
import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getAccountCapacity, listAccountAttentionItems, listAccountCommunities, listAccountWatchers,
  type AccountCapacity, type AccountCommunitySummary, type AccountWatcherRow,
} from "@/src/lib/products/watch-runtime";

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
 *  re-deriving them slightly differently.
 *
 *  Fetches Communities/Watchers ONCE and threads them into both
 *  `getAccountCapacity`/`listAccountAttentionItems` — previously each of
 *  those independently re-fetched Communities/Watchers (and
 *  `listAccountAttentionItems` additionally re-ran the ENTIRE
 *  `getAccountCapacity` computation a second time internally), meaning this
 *  one shared function — called on literally every real Watch page — fired
 *  `listAccountCommunities`'s own 4-sequential-round-trip chain 3+ times per
 *  page load. Live-reported as generalized app slowness ("Overview or other
 *  menus takes forever"); fixed by computing the shared inputs once and
 *  passing them down, not by adding any caching layer (no request-scoped or
 *  cross-request cache — every value here is still fetched fresh on every
 *  call, just without the redundant repeat trips). */
export interface WatchShellContext {
  capacity: AccountCapacity | null;
  attentionCount: number;
  /** Exposed so a page's OWN data-fetch (e.g. `/communities`'s Community
   *  Health table, `/usage`'s slot breakdown) can reuse these instead of
   *  independently re-fetching the same 4-round-trip Communities chain this
   *  function already resolved — the "shell fetch vs. page fetch" duplication
   *  layer that survived the v1.47.82 fix, since each page still called
   *  `getWatchShellContext` AND its own `listAccountCommunities`/
   *  `getAccountCapacity`/etc. independently. Pages should pass these into
   *  every downstream call that accepts a pre-fetched-data parameter. */
  communities: AccountCommunitySummary[];
  watchers: AccountWatcherRow[];
}

export async function getWatchShellContext(admin: SupabaseClient, accountId: string): Promise<WatchShellContext> {
  const communities = await listAccountCommunities(admin, accountId);
  const watchers = await listAccountWatchers(admin, accountId, communities);
  const capacity = await getAccountCapacity(admin, accountId, { communities, watchers });
  const attentionItems = await listAccountAttentionItems(admin, accountId, { communities, watchers, capacity });
  return { capacity, attentionCount: attentionItems.length, communities, watchers };
}

export type SupportPageContext =
  | { authenticated: true; accountId: string; admin: SupabaseClient; shell: WatchShellContext }
  | { authenticated: false };

/** The Help Center (`/support`, `/support/[category]`, `/support/[category]/[slug]`)
 *  is real product documentation, not account data — it must be reachable
 *  by prospects and search engines, not just signed-in customers (per
 *  explicit product decision: "docs should be accessible even outside
 *  Innvil Watch"). Still Watch-host-only (these pages don't exist on the
 *  main Innvil host), but authentication is now OPTIONAL rather than
 *  required — a signed-in visitor still gets the full authenticated
 *  `WatchShell` experience (sidebar, capacity, "needs attention"); a
 *  signed-out one gets the lighter public `PublicDocsShell` instead. Never
 *  redirects to `/login` the way `requireWatchPage()` does. */
export async function getSupportPageContext(): Promise<SupportPageContext> {
  if (!(await isWatchHost())) redirect("/");
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { authenticated: false };
  const shell = await getWatchShellContext(admin, user.id);
  return { authenticated: true, accountId: user.id, admin, shell };
}
