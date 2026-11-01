"use client";

import React, { useState } from "react";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import { ProjectDeployWatcherModal, type ProjectCommunityOption } from "./ProjectDeployWatcherModal";

/** The "Add Watcher" call-to-action on a Project's Communities/Watchers
 *  tabs — a thin client wrapper (mirrors WatcherConnectCta's exact shape)
 *  around ProjectDeployWatcherModal so the rest of the Project detail page
 *  stays a server component. `projectId` is this page's own fixed context
 *  — never re-asked, never guessed. */
export function ProjectAddWatcherCta({
  projectId, deployableWatchers, communities,
}: {
  projectId: string;
  deployableWatchers: AccountWatcherRow[];
  communities: ProjectCommunityOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="w-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg">
        + Add Watcher
      </button>
      {open && (
        <ProjectDeployWatcherModal
          projectId={projectId}
          deployableWatchers={deployableWatchers}
          communities={communities}
          onClose={() => setOpen(false)}
          onDeployed={() => window.location.reload()}
        />
      )}
    </>
  );
}
