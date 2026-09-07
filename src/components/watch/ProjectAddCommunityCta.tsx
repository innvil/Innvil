"use client";

import React, { useState } from "react";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import { ProjectAddCommunityModal } from "./ProjectAddCommunityModal";

/** The "Add Community" call-to-action on a Project's Communities tab --
 *  step 1 of the Project -> Add Community -> Add Watcher sequence. `projectId`
 *  is this page's own fixed context -- never re-asked, never guessed. */
export function ProjectAddCommunityCta({
  projectId, deployableWatchers,
}: {
  projectId: string;
  deployableWatchers: AccountWatcherRow[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="w-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg">
        + Add Community
      </button>
      {open && (
        <ProjectAddCommunityModal
          projectId={projectId}
          deployableWatchers={deployableWatchers}
          onClose={() => setOpen(false)}
          onConnected={() => window.location.reload()}
        />
      )}
    </>
  );
}
