"use client";

import React, { useState } from "react";
import { Lock, Wrench, FileText } from "lucide-react";
import { PanelStatus } from "@/src/data/constants";
import { CustomerLanding } from "./CustomerLanding";
import { CustomerDashboard } from "./CustomerDashboard";

export { CustomerLanding } from "./CustomerLanding";
export { CustomerDashboard } from "./CustomerDashboard";
export { NewOrder } from "./NewOrder";
export { PlatformGlyph, PlatformButton } from "./PlatformIcons";

/* =========================================================
   CUSTOMER PANEL — the full customer-facing experience
   Landing (Create Account / Log In) → Dashboard.
   Status-aware: offline screens for suspended/maintenance/
   draft, inactive banner + paused ordering for inactive.
   ========================================================= */

function OfflineScreen({ status }: { status: PanelStatus }) {
  const config = {
    suspended: {
      icon: Lock,
      iconCls: "text-red-400 bg-red-500/10",
      title: "Panel Suspended",
      body: "This panel is currently unavailable. Please contact the panel owner for more information.",
    },
    maintenance: {
      icon: Wrench,
      iconCls: "fp-violet bg-[rgba(139,127,255,0.10)]",
      title: "Under Maintenance",
      body: "We're currently performing scheduled maintenance. The panel will be back shortly.",
    },
    draft: {
      icon: FileText,
      iconCls: "fp-text-dim bg-[rgba(149,151,163,0.10)]",
      title: "Panel Not Available",
      body: "This panel is still being set up. Please check back later.",
    },
  }[status as "suspended" | "maintenance" | "draft"];

  if (!config) return null;
  const Icon = config.icon;

  return (
    <div className="fp-root min-h-screen fp-grid-bg flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${config.iconCls}`}>
          <Icon size={36} />
        </div>
        <h1 className="fp-display text-3xl mb-4">{config.title}</h1>
        <p className="fp-text-dim">{config.body}</p>
      </div>
    </div>
  );
}

export function CustomerPanel({
  demoStatus = "live",
  previewControls = false,
}: {
  demoStatus?: PanelStatus;
  /** Preview-only status switcher bar. Never enable on a real customer route —
      customers only ever see the *effects* of a status (offline screen,
      inactive banner), not the status controls themselves. */
  previewControls?: boolean;
}) {
  const [status, setStatus] = useState<PanelStatus>(demoStatus);
  const [authed, setAuthed] = useState(false);

  const statusOptions: Array<{ k: PanelStatus; label: string }> = [
    { k: "live", label: "Live Panel" },
    { k: "inactive", label: "Inactive Mode" },
    { k: "suspended", label: "Suspended" },
    { k: "maintenance", label: "Maintenance" },
    { k: "draft", label: "Draft" },
  ];

  const isOffline = status === "suspended" || status === "maintenance" || status === "draft";
  const inactive = status === "inactive";

  return (
    <div>
      {/* Preview-only status switcher bar — never rendered for real customers */}
      {previewControls && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#0D0F14] border-b border-[#262A35] px-4 py-2">
          <div className="max-w-6xl mx-auto flex items-center gap-4 overflow-x-auto">
            <span className="text-xs fp-mono fp-text-faint shrink-0">Preview Panel Status:</span>
            <div className="flex gap-2">
              {statusOptions.map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => setStatus(opt.k)}
                  className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    status === opt.k ? "fp-violet-soft-bg fp-violet" : "fp-text-dim hover:fp-text"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setAuthed(!authed)}
              className="ml-auto text-xs fp-text-dim hover:fp-text shrink-0 fp-mono"
            >
              {authed ? "View as guest" : "View as logged-in"}
            </button>
          </div>
        </div>
      )}

      <div className={previewControls ? "pt-10" : ""}>
        {isOffline ? (
          <OfflineScreen status={status} />
        ) : authed ? (
          <CustomerDashboard
            canOrder={status === "live"}
            inactive={inactive}
            onLogout={() => setAuthed(false)}
          />
        ) : (
          <CustomerLanding inactive={inactive} onAuthed={() => setAuthed(true)} />
        )}
      </div>
    </div>
  );
}
