"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AccountCommunitySummary, AccountWatcherRow } from "@/src/lib/products/watch-runtime";

/** Community/Watcher filter controls for the Activity page — pushes the
 *  selection into the URL's query string (`?community=...&watcher=...`) so
 *  the server page re-fetches a correctly-filtered `listAccountActivity`
 *  call; no client-side data fetching of its own. */
export function ActivityFilters({ communities, watchers }: { communities: AccountCommunitySummary[]; watchers: AccountWatcherRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`/activity${next.toString() ? `?${next.toString()}` : ""}`);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={searchParams.get("community") ?? ""}
        onChange={(e) => setParam("community", e.target.value)}
        className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border"
      >
        <option value="">All Communities</option>
        {communities.map((c) => <option key={c.id} value={c.id}>{c.title ?? c.chatId}</option>)}
      </select>
      <select
        value={searchParams.get("watcher") ?? ""}
        onChange={(e) => setParam("watcher", e.target.value)}
        className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border"
      >
        <option value="">All Watchers</option>
        {watchers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <select
        value={searchParams.get("days") ?? "30"}
        onChange={(e) => setParam("days", e.target.value)}
        className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border"
      >
        <option value="1">Last 24 hours</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
      </select>
      {(searchParams.get("community") || searchParams.get("watcher") || searchParams.get("days")) && (
        <button onClick={() => router.push("/activity")} className="text-xs w-text-faint hover:w-text-dim">Clear filters</button>
      )}
    </div>
  );
}
