"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/src/lib/actions/auth";
import { withTimeout } from "@/src/lib/timeout";

const LOGOUT_TIMEOUT_MS = 8000;

/** Small client island so the mostly-server-rendered WatchLanding can still
 *  offer a way to sign out for a visitor who's authenticated but landed
 *  back on the marketing page (e.g. no Watch entitlement yet). */
export function WatchLogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logOut = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Bounded so a hung/failed call can never leave the button stuck
      // showing "Signing out…" forever with no way to recover.
      await withTimeout(signOutAction(), LOGOUT_TIMEOUT_MS, "Sign out");
    } catch (err) {
      console.error("[watch] sign out failed", err);
      setError("Sign out failed or timed out.");
      setBusy(false);
      return;
    }
    // Hard navigation, not router.refresh() -- guarantees a genuinely fresh
    // server render of "/" against the now-cleared cookie.
    window.location.href = "/";
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={logOut}
        disabled={busy}
        className="text-sm w-text-dim hover:w-text flex items-center gap-1.5 disabled:opacity-60"
      >
        <LogOut size={14} /> {busy ? "Signing out…" : "Log out"}
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
