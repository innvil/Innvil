"use server";

/**
 * Thin auth wrappers around the session-less core in
 * src/lib/products/ownership.ts — resolves the authenticated account, then
 * delegates. Mirrors the established "action = thin auth wrapper over a
 * plain lib function" pattern already used elsewhere in this codebase
 * (e.g. orders/place.ts's placeOrderForAccount).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { hasProductAccess, createStandaloneProject, listAccountProjects, type AccountProjectRow } from "@/src/lib/products/ownership";
import { WATCH_PRODUCT_SLUG } from "@/src/lib/products/watch";

export interface WatchAccessState {
  authenticated: boolean;
  entitled: boolean;
  projects: AccountProjectRow[];
}

/** Resolves what the current visitor should see on the Watch domain:
 *  unauthenticated (show landing/pricing), authenticated-but-not-entitled
 *  (show activation/purchase), or authenticated-and-entitled (show the
 *  Watch dashboard with their real Projects). */
export async function getWatchAccessState(): Promise<WatchAccessState> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { authenticated: false, entitled: false, projects: [] };

  const entitled = await hasProductAccess(admin, user.id, WATCH_PRODUCT_SLUG);
  const projects = entitled ? await listAccountProjects(admin, user.id) : [];
  return { authenticated: true, entitled, projects };
}

export async function createWatchProject(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const result = await createStandaloneProject(admin, user.id, name);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not create the project." };
  return { ok: true };
}
