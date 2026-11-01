"use client";

import React, { useState } from "react";

export interface WatchTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

/** Simple client-side tab switcher for a resource's nested "world" (Project
 *  Overview/Knowledge/Communities/Watchers/Activity, Community Overview/
 *  Watchers/Moderation/Activity, Watcher Overview/Persona/Deployment/
 *  Activity). All tab content is fetched server-side up front and passed in
 *  as already-rendered nodes — this component only controls VISIBILITY, so
 *  switching tabs never re-fetches or flashes a loading state. */
export function WatchTabs({ tabs, defaultTab }: { tabs: WatchTab[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  return (
    <div>
      <div role="tablist" aria-label="Sections" className="flex items-center gap-1 border-b w-line-soft mb-5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              active === t.id ? "w-teal border-current" : "w-text-dim border-transparent hover:w-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id}>
          {active === t.id && t.content}
        </div>
      ))}
    </div>
  );
}
