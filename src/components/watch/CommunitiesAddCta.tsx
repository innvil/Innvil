"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import type { AccountProjectRow } from "@/src/lib/products/ownership";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import { ProjectAddCommunityModal } from "./ProjectAddCommunityModal";
import { CreateProjectButton } from "./ProjectsClient";

/** The account-wide "+ Add Community" action on the Communities tracker
 *  (/communities). A Community always nests inside a Project -- this is a
 *  thin Project-picker step in front of the SAME real, Telegram-membership-
 *  verified `ProjectAddCommunityModal` every Project detail page's own "Add
 *  Community" already uses (never a second/parallel connect flow, and never
 *  a second copy of the connect logic). With zero Projects yet, there's
 *  nothing to nest a Community into -- this points straight at creating one
 *  first, via the exact same CreateProjectButton the Projects list page uses. */
export function CommunitiesAddCta({
  projects, deployableWatchers,
}: {
  projects: AccountProjectRow[];
  deployableWatchers: AccountWatcherRow[];
}) {
  const [step, setStep] = useState<"pick" | "connect" | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");

  if (projects.length === 0) return <CreateProjectButton />;

  return (
    <>
      <button
        onClick={() => { setProjectId(projects[0]?.id ?? ""); setStep("pick"); }}
        className="w-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg"
      >
        + Add Community
      </button>
      {step === "pick" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Choose a Project">
          <div className="absolute inset-0 bg-black/60" onClick={() => setStep(null)} aria-hidden="true" />
          <div className="relative w-full max-w-sm w-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="w-display text-base">Add Community to which Project?</h3>
              <button onClick={() => setStep(null)} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
            </div>
            <p className="text-sm w-text-dim mb-3">A Community always nests inside a Project — pick which one this new Telegram connection belongs to.</p>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              onClick={() => setStep("connect")}
              disabled={!projectId}
              className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </div>
      )}
      {step === "connect" && (
        <ProjectAddCommunityModal
          projectId={projectId}
          deployableWatchers={deployableWatchers}
          onClose={() => setStep(null)}
          onConnected={() => window.location.reload()}
        />
      )}
    </>
  );
}
