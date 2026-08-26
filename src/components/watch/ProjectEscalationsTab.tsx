"use client";

import React, { useState } from "react";
import { CheckCircle2, Loader2, MessageCircleQuestion } from "lucide-react";
import { promoteEscalationToKnowledge, type AccountEscalationRow } from "@/src/lib/actions/watch-escalations";
import { EmptyRow, SectionHeader, relTime } from "./WatchUI";

const STATUS_LABEL: Record<AccountEscalationRow["status"], string> = { open: "Open", answered: "Answered", closed: "Saved to Knowledge" };
const STATUS_CLASS: Record<AccountEscalationRow["status"], string> = {
  open: "w-amber",
  answered: "w-teal",
  closed: "w-green",
};

function SaveAsKnowledgeForm({ escalation, onSaved }: { escalation: AccountEscalationRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await promoteEscalationToKnowledge(escalation.id, expiresAt ? new Date(expiresAt).toISOString() : null);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onSaved();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs w-teal hover:underline font-medium">
        Save as Project Knowledge
      </button>
    );
  }
  return (
    <div className="mt-2 p-3 w-surface-raised rounded-lg border w-line-soft">
      <label className="text-[11px] w-text-faint block mb-1">Expires (optional — for time-sensitive facts like a launch date)</label>
      <input
        type="date"
        value={expiresAt}
        onChange={(e) => setExpiresAt(e.target.value)}
        className="w-full w-surface border w-line-soft rounded-md px-2 py-1.5 text-xs w-text outline-none focus:w-teal-border mb-2"
      />
      {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="w-btn-primary text-xs font-semibold px-3 py-1.5 rounded-md disabled:opacity-60">
          {busy ? <Loader2 size={12} className="animate-spin" /> : "Save"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs w-text-faint hover:w-text-dim">Cancel</button>
      </div>
    </div>
  );
}

/** Shared Escalation Group (Phase 1) dashboard — a plain Open/Answered list
 *  per the plan's own scope decision (the full metrics dashboard — Knowledge
 *  Added / Expired / High Volume counters — is explicitly deferred). Every
 *  answered-but-not-yet-promoted escalation gets a real "Save as Project
 *  Knowledge" action; a closed (already-promoted) one shows that it's
 *  reusable now. */
export function ProjectEscalationsTab({ initialEscalations }: { initialEscalations: AccountEscalationRow[] }) {
  const [escalations, setEscalations] = useState(initialEscalations);

  return (
    <div className="w-card p-5">
      <SectionHeader icon={MessageCircleQuestion} title="Escalations" />
      <p className="text-xs w-text-faint mb-4 -mt-2">
        When a Watcher can't confidently answer from Project Knowledge, it forwards the question to your connected Escalation Group instead of
        guessing. Reply there as a real admin of that group to answer it — the approved answer is relayed back automatically.
      </p>
      {escalations.length === 0 ? (
        <EmptyRow text="No escalations yet. Once a Watcher can't confidently answer a question, it'll show up here." />
      ) : (
        <ul className="space-y-3">
          {escalations.map((e) => (
            <li key={e.id} className="border w-line-soft rounded-lg p-3.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={`text-[11px] font-semibold uppercase tracking-wide ${STATUS_CLASS[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                <span className="text-[11px] w-text-faint">{relTime(e.createdAt)}</span>
              </div>
              <p className="text-sm w-text mb-1">&ldquo;{e.questionText}&rdquo;</p>
              <p className="text-[11px] w-text-faint mb-2">
                {e.watcherName} · {e.sourceCommunityTitle ?? "a community"} · asked by {e.askerDisplayName ?? "a member"}
              </p>
              {e.answerText && (
                <div className="p-2.5 w-surface-raised rounded-md mb-2">
                  <p className="text-xs w-text leading-snug">{e.answerText}</p>
                </div>
              )}
              {e.status === "answered" && (
                <SaveAsKnowledgeForm
                  escalation={e}
                  onSaved={() => setEscalations((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: "closed" } : x)))}
                />
              )}
              {e.status === "closed" && (
                <span className="text-[11px] w-green flex items-center gap-1">
                  <CheckCircle2 size={11} /> Reusable in Project Knowledge
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
