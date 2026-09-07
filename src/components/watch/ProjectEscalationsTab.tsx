"use client";

import React, { useState } from "react";
import { CheckCircle2, Loader2, MessageCircleQuestion, ShieldAlert, ShieldOff, AlertTriangle, Radio } from "lucide-react";
import { promoteEscalationToKnowledge, type AccountEscalationRow, type AccountModerationReportRow } from "@/src/lib/actions/watch-escalations";
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

const VIOLATION_LABEL: Record<AccountModerationReportRow["violationCategory"], string> = {
  spam: "Spam",
  scam_link: "Scam Link",
  nsfw: "Prohibited Content",
  explicit_link: "Explicit Link",
};

function reportHeading(r: AccountModerationReportRow): string {
  if (r.telegramActionFailed) return "Moderation Action Partially Failed";
  const kicked = r.actionTypes.includes("kick") || r.actionTypes.includes("ban");
  if (r.violationCategory === "nsfw" || r.violationCategory === "explicit_link") return "User Removed — Prohibited Content";
  if (r.violationCategory === "scam_link") return kicked ? "User Removed — Repeated Scam Links" : "Scam Link Removed";
  if (kicked) return "User Removed — Repeated Spam";
  if (r.warningNumber === 1) return "Spam Warning";
  return "Repeated Spam";
}

/** Watcher Ops: the private Escalation Group's dashboard mirror — unresolved
 *  questions (Knowledge Escalation) AND real moderation actions Watchers
 *  took (Moderation Action), rendered together the same way they coexist in
 *  the real Telegram group, with a clear visual distinction between the two
 *  kinds so an admin can immediately tell "unresolved question" from "real
 *  enforcement event" (spec §18). A plain Open/Answered/reports list per the
 *  plan's own scope decision — the full metrics dashboard (Knowledge Added /
 *  Expired / High Volume counters) is explicitly deferred. */
export function ProjectEscalationsTab({
  initialEscalations,
  initialModerationReports,
  hasEscalationGroup,
}: {
  initialEscalations: AccountEscalationRow[];
  initialModerationReports: AccountModerationReportRow[];
  hasEscalationGroup: boolean;
}) {
  const [escalations, setEscalations] = useState(initialEscalations);

  type Item = { kind: "escalation"; at: string; data: AccountEscalationRow } | { kind: "report"; at: string; data: AccountModerationReportRow };
  const items: Item[] = [
    ...escalations.map((e): Item => ({ kind: "escalation", at: e.createdAt, data: e })),
    ...initialModerationReports.map((r): Item => ({ kind: "report", at: r.createdAt, data: r })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="space-y-4">
      {!hasEscalationGroup && (
        <div className="w-card p-4 border w-amber-border">
          <div className="flex items-start gap-2.5">
            <ShieldOff size={16} className="w-amber shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold w-text mb-1">Watcher Ops not configured</p>
              <p className="text-xs w-text-dim leading-relaxed">
                Connect a private Escalation Group to receive moderation reports, removed-user history, purge results, and unanswered
                community questions — strongly recommended, and it never consumes a Watcher slot or counts toward your Community
                allowance. Use &ldquo;+ Connect Escalation Group&rdquo; on the Communities tab.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="w-card p-5">
        <SectionHeader icon={MessageCircleQuestion} title="Watcher Ops" />
        <p className="text-xs w-text-faint mb-4 -mt-2">
          Your private operational record — unanswered questions Watchers forwarded to your team, and the moderation actions
          (warnings, mutes, kicks, purges, scam/NSFW removals) they took on their own. Reply to a question in your Escalation Group as
          a real admin to answer it.
        </p>
        {items.length === 0 ? (
          <EmptyRow text="Nothing here yet. Unresolved questions and real moderation actions will show up here as they happen." />
        ) : (
          <ul className="space-y-3">
            {items.map((item) =>
              item.kind === "escalation" ? (
                <li key={`e-${item.data.id}`} className="border w-line-soft rounded-lg p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide w-teal flex items-center gap-1">
                      <MessageCircleQuestion size={11} /> Knowledge Escalation
                    </span>
                    <span className="text-[11px] w-text-faint">{relTime(item.data.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLASS[item.data.status]}`}>{STATUS_LABEL[item.data.status]}</span>
                  </div>
                  <p className="text-sm w-text mb-1">&ldquo;{item.data.questionText}&rdquo;</p>
                  <p className="text-[11px] w-text-faint mb-2">
                    {item.data.watcherName} · {item.data.sourceCommunityTitle ?? "a community"} · asked by {item.data.askerDisplayName ?? "a member"}
                  </p>
                  {item.data.answerText && (
                    <div className="p-2.5 w-surface-raised rounded-md mb-2">
                      <p className="text-xs w-text leading-snug">{item.data.answerText}</p>
                    </div>
                  )}
                  {item.data.status === "answered" && (
                    <SaveAsKnowledgeForm
                      escalation={item.data}
                      onSaved={() => setEscalations((prev) => prev.map((x) => (x.id === item.data.id ? { ...x, status: "closed" } : x)))}
                    />
                  )}
                  {item.data.status === "closed" && (
                    <span className="text-[11px] w-green flex items-center gap-1">
                      <CheckCircle2 size={11} /> Reusable in Project Knowledge
                    </span>
                  )}
                </li>
              ) : (
                <li key={`r-${item.data.id}`} className="border w-line-soft rounded-lg p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className={`text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1 ${item.data.telegramActionFailed ? "w-red" : "w-amber"}`}>
                      {item.data.telegramActionFailed ? <AlertTriangle size={11} /> : <ShieldAlert size={11} />}
                      {item.data.telegramActionFailed ? "Watcher Error" : "Moderation Action"}
                    </span>
                    <span className="text-[11px] w-text-faint">{relTime(item.data.createdAt)}</span>
                  </div>
                  <p className="text-sm w-text font-medium mb-1">{reportHeading(item.data)}</p>
                  <p className="text-[11px] w-text-faint mb-2">
                    {VIOLATION_LABEL[item.data.violationCategory]} · {item.data.watcherName} · {item.data.sourceCommunityTitle ?? "a community"} ·{" "}
                    {item.data.username ? `@${item.data.username}` : item.data.displayName ?? "a member"}
                  </p>
                  <div className="p-2.5 w-surface-raised rounded-md">
                    <pre className="text-xs w-text-dim leading-snug whitespace-pre-wrap font-sans">{item.data.reportText}</pre>
                  </div>
                  {!item.data.sent && (
                    <p className="text-[11px] w-red mt-2 flex items-center gap-1"><Radio size={10} /> Not delivered to Watcher Ops — check your Escalation Group connection</p>
                  )}
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
