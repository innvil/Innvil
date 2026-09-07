"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { WatchTab } from "./WatchTabs";

/** Settings-specific left sub-navigation + content pane — deliberately
 *  distinct from the horizontal `WatchTabs` used on Project/Community/
 *  Watcher detail pages. Settings holds account-wide CONFIGURATION rather
 *  than one resource's own tabs, so a vertical settings-style navigator
 *  reads more like a real admin console than another horizontal tab row.
 *  The active section is mirrored into the URL (?section=) for deep
 *  linking/refresh/support-link use, without a full route rewrite — just a
 *  shallow `router.replace` on selection, and reading the initial value
 *  from the URL on mount. */
export function SettingsSectionNav({ tabs, defaultTab }: { tabs: WatchTab[]; defaultTab?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const validIds = tabs.map((t) => t.id);
  const fromUrl = searchParams.get("section");
  const initial = fromUrl && validIds.includes(fromUrl) ? fromUrl : (defaultTab ?? tabs[0]?.id);

  const [active, setActive] = useState(initial);
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  // Keep local state in sync if the URL changes out from under us (e.g. a
  // support link with ?section=security, or browser back/forward).
  useEffect(() => {
    if (fromUrl && validIds.includes(fromUrl) && fromUrl !== active) setActive(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const select = (id: string) => {
    setActive(id);
    router.replace(`${pathname}?section=${id}`, { scroll: false });
  };

  return (
    <div className="flex flex-col sm:flex-row gap-6">
      <nav aria-label="Settings sections" className="sm:w-44 shrink-0">
        <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={active === t.id ? "page" : undefined}
              onClick={() => select(t.id)}
              className={`text-left px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                active === t.id ? "w-teal font-medium w-teal-soft-bg" : "w-text-faint hover:w-text-dim"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="flex-1 min-w-0 max-w-2xl">{activeTab?.content}</div>
    </div>
  );
}
