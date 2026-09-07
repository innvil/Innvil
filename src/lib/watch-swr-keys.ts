/**
 * Central registry of SWR cache keys used by the cache-first Watch
 * dashboard pages. Kept in one small, dependency-free module (no imports
 * beyond plain strings) specifically so both a page's Client Component
 * (which reads the key via `useSWR`) and any component that mutates that
 * page's data (which calls `mutate(key)` to revalidate it) can import the
 * SAME constant without creating a circular import between the two.
 *
 * Naming convention: `watch:<page>` for a whole-page dataset, `watch:<page>:<id>`
 * for a specific resource's detail data.
 */
export const WATCH_SWR_KEYS = {
  overview: "watch:overview",
  watchers: "watch:watchers",
  communities: "watch:communities",
  projects: "watch:projects",
  activity: "watch:activity",
  deployments: "watch:deployments",
  profile: "watch:profile",
  usage: "watch:usage",
  plans: "watch:plans",
  billing: "watch:billing",
  settings: "watch:settings",
  projectDetail: (id: string) => ["watch:project", id] as const,
  communityDetail: (id: string) => ["watch:community", id] as const,
  watcherDetail: (id: string) => ["watch:watcher", id] as const,
} as const;
