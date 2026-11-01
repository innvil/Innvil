"use client";

import React, { useState } from "react";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import type { AccountProjectRow } from "@/src/lib/products/ownership";
import { WatcherConnectModal } from "./WatcherConnectModal";

const CONNECTED_STATUSES = new Set(["active", "bot_ready", "community_setup_required"]);

/** The "Connect a Community" call-to-action on a Watcher's detail page —
 *  a thin client wrapper around the existing WatcherConnectModal so the rest
 *  of the detail page can stay a server component. */
export function WatcherConnectCta({ watcher, projects }: { watcher: AccountWatcherRow; projects: AccountProjectRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">
        {CONNECTED_STATUSES.has(watcher.provisioningStatus) ? "Connect a Community" : "Connect to Telegram"}
      </button>
      {open && (
        <WatcherConnectModal
          watcher={watcher}
          projects={projects}
          onClose={() => setOpen(false)}
          onConnected={() => window.location.reload()}
        />
      )}
    </>
  );
}
