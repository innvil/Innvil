"use client";

import React, { useState } from "react";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import { ProjectAddCommunityModal } from "./ProjectAddCommunityModal";

/** "Connect Escalation Group" -- reuses the EXACT SAME real Telegram-
 *  membership-verified connect flow as "Add Community" (ProjectAddCommunityModal),
 *  just tagged connectionType: 'escalation_group' so watch-runtime.ts's 0-slot
 *  billing exclusion applies. `projectId` is this page's own fixed context --
 *  never re-asked, never guessed. */
export function ProjectAddEscalationGroupCta({
  projectId, deployableWatchers,
}: {
  projectId: string;
  deployableWatchers: AccountWatcherRow[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="w-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg">
        + Connect Escalation Group
      </button>
      {open && (
        <ProjectAddCommunityModal
          projectId={projectId}
          deployableWatchers={deployableWatchers}
          connectionType="escalation_group"
          onClose={() => setOpen(false)}
          onConnected={() => window.location.reload()}
        />
      )}
    </>
  );
}
