"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DAY_OPTIONS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

/** Watcher + date-range filters for a Community's own Moderation tab —
 *  pushes `?watcher=&days=&tab=moderation` so the server page re-queries a
 *  correctly-filtered `listAccountActivity` call and stays on this tab after
 *  the navigation (mirrors the global Activity page's ActivityFilters). */
export function CommunityModerationFilters({ communityId, watchers }: { communityId: string; watchers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.set("tab", "moderation");
    router.push(`/communities/${communityId}?${next.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={searchParams.get("days") ?? "7"}
        onChange={(e) => setParam("days", e.target.value)}
        className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border"
      >
        {DAY_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <select
        value={searchParams.get("watcher") ?? ""}
        onChange={(e) => setParam("watcher", e.target.value)}
        className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border"
      >
        <option value="">All Watchers</option>
        {watchers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </div>
  );
}
