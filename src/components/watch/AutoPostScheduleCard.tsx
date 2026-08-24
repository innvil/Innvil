"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Trash2 } from "lucide-react";
import {
  getCommunityTimezone, setCommunityTimezone, listCommunityDeployments, listAutoPostWindows,
  createAutoPostWindow, setAutoPostWindowEnabled, deleteAutoPostWindow, listRecentAutoPosts,
  type AutoPostWindowRow, type AutoPostOccurrenceRow, type CommunityDeploymentOption,
} from "@/src/lib/actions/watch-autopost";
import { SectionHeader, EmptyRow } from "./WatchUI";

const OCCURRENCE_STATUS_LABELS: Record<AutoPostOccurrenceRow["status"], string> = {
  scheduled: "Scheduled", generating: "Generating", generated: "Generated", publishing: "Publishing",
  published: "Published", publish_failed: "Publish failed", failed: "Failed", missed: "Missed", cancelled: "Cancelled",
};

/** AI Telegram Auto-Posting — Community tab (Phase 4.N.1, the standalone-
 *  account counterpart to the legacy owner-facing AutoPostingCard in
 *  AdminTabs.tsx). Each assigned Watcher publishes AT MOST one AI-generated
 *  post per day, at a random time inside its own window, grounded only in
 *  Project/Community Knowledge — never a fixed schedule, never fabricated
 *  facts. Scoped to the SINGLE community this tab lives on (no community
 *  selector needed, unlike the legacy multi-community owner surface). */
export function AutoPostScheduleCard({ communityId, deployableCount, eligible }: { communityId: string; deployableCount: number; eligible: boolean }) {
  const [timezone, setTimezoneState] = useState("UTC");
  const [deployments, setDeployments] = useState<CommunityDeploymentOption[]>([]);
  const [windows, setWindows] = useState<AutoPostWindowRow[] | null>(null);
  const [recent, setRecent] = useState<AutoPostOccurrenceRow[]>([]);
  const [deploymentId, setDeploymentId] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [saving, setSaving] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const [tz, deps, wins, occs] = await Promise.all([
      getCommunityTimezone(communityId),
      listCommunityDeployments(communityId),
      listAutoPostWindows(communityId),
      listRecentAutoPosts(communityId, 10),
    ]);
    if (tz.ok) setTimezoneState(tz.data);
    if (deps.ok) { setDeployments(deps.data); setDeploymentId((prev) => prev || deps.data[0]?.deploymentId || ""); }
    if (wins.ok) setWindows(wins.data);
    if (occs.ok) setRecent(occs.data);
  }, [communityId]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveTimezone = async () => {
    setSavingTz(true);
    const res = await setCommunityTimezone(communityId, timezone);
    setSavingTz(false);
    setMsg(res.ok ? { text: "Timezone saved." } : { text: res.error, error: true });
  };

  const addWindow = async () => {
    if (!deploymentId) { setMsg({ text: "No Watcher deployed in this Community yet.", error: true }); return; }
    setSaving(true);
    setMsg(null);
    const res = await createAutoPostWindow(communityId, deploymentId, start, end);
    setSaving(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    await refresh();
  };

  const toggleWindow = async (w: AutoPostWindowRow) => {
    await setAutoPostWindowEnabled(communityId, w.id, !w.enabled);
    await refresh();
  };

  const removeWindow = async (id: string) => {
    await deleteAutoPostWindow(communityId, id);
    await refresh();
  };

  if (!eligible) {
    return (
      <div className="w-card p-5">
        <SectionHeader icon={Bot} title="Auto-Posting" />
        <p className="text-sm w-text-dim mt-2">Auto-Posting isn't included on your current plan. Upgrade on the <a href="/plans" className="w-teal hover:underline">Plans page</a> to unlock it.</p>
      </div>
    );
  }

  return (
    <div className="w-card p-5">
      <SectionHeader icon={Bot} title="Auto-Posting" />
      <p className="text-xs w-text-faint -mt-2 mb-4">
        Each assigned Watcher publishes at most one AI-generated post per day, at a random time inside its own
        window, grounded only in your Project/Community Knowledge — never a fixed schedule, never fabricated facts.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <input
          value={timezone}
          onChange={(e) => setTimezoneState(e.target.value)}
          placeholder="Timezone, e.g. Asia/Manila"
          className="flex-1 text-xs w-surface-raised border w-line-soft rounded-lg px-3 py-2 w-text outline-none focus:w-teal-border"
        />
        <button type="button" onClick={saveTimezone} disabled={savingTz} className="text-xs w-text-faint hover:w-text px-3 py-2 rounded-lg border w-line-soft disabled:opacity-60">
          {savingTz ? "Saving…" : "Save"}
        </button>
      </div>

      {deployableCount === 0 ? (
        <EmptyRow text="No Watchers deployed to this Community yet." />
      ) : deployments.length === 0 ? (
        <p className="text-xs w-text-faint mb-4">No Watchers deployed in this Community yet.</p>
      ) : (
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <select value={deploymentId} onChange={(e) => setDeploymentId(e.target.value)} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-2 w-text outline-none focus:w-teal-border">
              {deployments.map((d) => <option key={d.deploymentId} value={d.deploymentId}>{d.moderatorName}</option>)}
            </select>
            <input type="text" value={start} onChange={(e) => setStart(e.target.value)} placeholder="09:00" className="w-20 text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-2 w-text outline-none focus:w-teal-border" />
            <span className="text-xs w-text-faint">to</span>
            <input type="text" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="17:00" className="w-20 text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-2 w-text outline-none focus:w-teal-border" />
            <button type="button" onClick={addWindow} disabled={saving} className="w-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60 flex items-center gap-1.5">
              {saving && <Loader2 size={12} className="animate-spin" />} Add window
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`text-xs mb-3 ${msg.error ? "w-red" : "w-green"}`}>{msg.text}</p>}

      <div className="space-y-2 mb-4">
        {windows === null ? (
          <p className="text-sm w-text-faint py-2 text-center">Loading…</p>
        ) : windows.length === 0 ? (
          <p className="text-xs w-text-faint">No posting windows configured yet.</p>
        ) : windows.map((w) => (
          <div key={w.id} className={`w-surface-raised border w-line-soft rounded-lg p-3 flex items-center justify-between gap-3 ${!w.enabled ? "opacity-50" : ""}`}>
            <div className="min-w-0">
              <p className="text-sm font-semibold w-text">{w.moderatorName}</p>
              <p className="text-xs w-text-dim">{w.startLocalTime}–{w.endLocalTime} · 1 post/day{!w.enabled ? " · disabled" : ""}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => toggleWindow(w)} className="text-[11px] w-text-faint hover:w-text px-2 py-1 rounded-md w-surface border w-line-soft">
                {w.enabled ? "Disable" : "Enable"}
              </button>
              <button type="button" onClick={() => removeWindow(w.id)} className="p-1.5 rounded-md w-surface border w-line-soft w-red hover:opacity-80">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2">Recent posts</p>
          <div className="space-y-1.5">
            {recent.map((o) => (
              <div key={o.id} className="text-xs w-text-dim flex items-center justify-between gap-2">
                <span className="truncate">{o.generatedTitle || o.localDate}</span>
                <span className="w-text-faint shrink-0">{OCCURRENCE_STATUS_LABELS[o.status]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
