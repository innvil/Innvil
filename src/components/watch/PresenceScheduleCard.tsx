"use client";

import React, { useState } from "react";
import { Radio, Loader2 } from "lucide-react";
import {
  getCommunityPresenceSchedule, resetToRecommendedSchedule, setDeploymentPresenceEnabled,
  setDeploymentPresenceConfig, setCommunityPresenceSettings, type CommunityPresenceSchedule,
} from "@/src/lib/actions/watch-presence";
import { presenceAt } from "@/src/lib/moderator/presence-schedule";
import { SectionHeader, EmptyRow } from "./WatchUI";

function minutesToHm(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function timeToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToTime(min: number | null): string {
  if (min == null) return "";
  const h = Math.floor(min / 60).toString().padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Watcher Presence Scheduling — Community tab. Deployed Watchers
 *  auto-stagger being "conversationally present," sending a scheduled
 *  arrival/departure message. This is announcement-only (explicit product
 *  decision) — turning presence off for a Watcher never affects whether it
 *  still answers questions; core moderation and reactive replies are
 *  completely unaffected by anything on this page. */
export function PresenceScheduleCard({ communityId, initial }: { communityId: string; initial: CommunityPresenceSchedule }) {
  const [schedule, setSchedule] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staggerInput, setStaggerInput] = useState(String(initial.staggerMinutes));
  const [coverageStart, setCoverageStart] = useState(minutesToTime(initial.coverageStartMinutes));
  const [coverageEnd, setCoverageEnd] = useState(minutesToTime(initial.coverageEndMinutes));
  const [customEditor, setCustomEditor] = useState<string | null>(null);
  const [customActive, setCustomActive] = useState("");
  const [customCycle, setCustomCycle] = useState("");

  const refresh = async () => {
    const res = await getCommunityPresenceSchedule(communityId);
    if (res.ok) setSchedule(res.data);
  };

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!schedule.eligible) {
    return (
      <div className="w-card p-5">
        <SectionHeader icon={Radio} title="Presence schedule" />
        <p className="text-sm w-text-dim mt-2">Watcher Presence Scheduling isn't included on your current plan. Upgrade on the <a href="/plans" className="w-teal hover:underline">Plans page</a> to unlock it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="w-card p-5">
        <SectionHeader
          icon={Radio}
          title="Presence schedule"
          action={<span className="text-[10px] uppercase tracking-wide w-text-faint font-semibold">{schedule.mode === "recommended" ? "Recommended" : "Custom"}</span>}
        />
        <p className="text-xs w-text-faint mt-1 mb-4">
          Deployed Watchers auto-stagger being "conversationally present," sending a scheduled arrival/departure message. This never affects moderation
          or whether a Watcher answers questions — announcements only.
        </p>

        <div className="flex items-end gap-2 flex-wrap mb-5">
          <div>
            <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Rotation stagger (minutes)</label>
            <input
              type="number" min={15} step={15} value={staggerInput} onChange={(e) => setStaggerInput(e.target.value)}
              className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border w-24"
            />
          </div>
          <button
            type="button" disabled={busy === "reset"}
            onClick={() => withBusy("reset", async () => {
              const n = Number(staggerInput);
              const res = await resetToRecommendedSchedule(communityId, Number.isFinite(n) && n > 0 ? n : undefined);
              if (!res.ok) throw new Error(res.error);
            })}
            className="text-xs w-teal hover:underline px-3 py-1.5 rounded-lg border w-line-soft disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy === "reset" && <Loader2 size={12} className="animate-spin" />} Reset to Recommended
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <div>
            <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Coverage window (local time, optional)</label>
            <div className="flex items-center gap-2">
              <input type="time" value={coverageStart} onChange={(e) => setCoverageStart(e.target.value)} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2 py-1.5 w-text outline-none focus:w-teal-border" />
              <span className="text-xs w-text-faint">to</span>
              <input type="time" value={coverageEnd} onChange={(e) => setCoverageEnd(e.target.value)} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2 py-1.5 w-text outline-none focus:w-teal-border" />
              <button
                type="button" disabled={busy === "coverage"}
                onClick={() => withBusy("coverage", async () => {
                  const res = await setCommunityPresenceSettings(communityId, {
                    coverageStartMinutes: coverageStart ? timeToMinutes(coverageStart) : null,
                    coverageEndMinutes: coverageEnd ? timeToMinutes(coverageEnd) : null,
                  });
                  if (!res.ok) throw new Error(res.error);
                })}
                className="text-xs w-teal hover:underline disabled:opacity-50"
              >
                Save
              </button>
            </div>
            <p className="text-[11px] w-text-faint mt-1">Never present outside this window, even if it's a Watcher's own rotation turn. Leave blank for no restriction.</p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Announce</label>
            <div className="space-y-1.5">
              {([
                ["announceStart", "Arrival"], ["announceReturn", "Return from a rotation"], ["announceEnd", "Stepping away"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs w-text-dim cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedule[key]}
                    onChange={(e) => withBusy(key, async () => {
                      const patch = key === "announceStart" ? { announceStart: e.target.checked } : key === "announceReturn" ? { announceReturn: e.target.checked } : { announceEnd: e.target.checked };
                      const res = await setCommunityPresenceSettings(communityId, patch);
                      if (!res.ok) throw new Error(res.error);
                    })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-xs w-red mb-3">{error}</p>}

        {schedule.deployments.length === 0 ? (
          <EmptyRow text="No Watchers deployed to this Community yet." />
        ) : (
          <div className="space-y-2">
            {schedule.deployments.map((d) => {
              const now = new Date();
              const live = d.presenceEnabled && d.anchorUtc && d.activeMinutes != null && d.cycleMinutes != null
                ? presenceAt({ anchorUtc: d.anchorUtc, activeMinutes: d.activeMinutes, cycleMinutes: d.cycleMinutes }, now)
                : null;
              return (
                <div key={d.deploymentId} className="border w-line-soft rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-sm w-text cursor-pointer">
                      <input
                        type="checkbox" checked={d.presenceEnabled}
                        disabled={busy === `enable-${d.deploymentId}`}
                        onChange={(e) => withBusy(`enable-${d.deploymentId}`, async () => {
                          const res = await setDeploymentPresenceEnabled(communityId, d.deploymentId, e.target.checked);
                          if (!res.ok) throw new Error(res.error);
                        })}
                      />
                      {d.watcherName}
                    </label>
                    {live && (
                      <span className={`text-xs ${live.present ? "w-green" : "w-text-faint"}`}>
                        {live.present ? "Present now" : "Away now"} · {minutesToHm(d.activeMinutes)} active every {minutesToHm(d.cycleMinutes)}
                      </span>
                    )}
                    {d.presenceEnabled && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomEditor(customEditor === d.deploymentId ? null : d.deploymentId);
                          setCustomActive(d.activeMinutes != null ? String(d.activeMinutes) : "");
                          setCustomCycle(d.cycleMinutes != null ? String(d.cycleMinutes) : "");
                        }}
                        className="text-xs w-teal hover:underline"
                      >
                        Customize
                      </button>
                    )}
                  </div>
                  {customEditor === d.deploymentId && (
                    <div className="flex items-end gap-2 mt-3 pt-3 border-t w-line-soft flex-wrap">
                      <div>
                        <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Active minutes</label>
                        <input type="number" min={5} value={customActive} onChange={(e) => setCustomActive(e.target.value)} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2 py-1.5 w-text outline-none focus:w-teal-border w-24" />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Cycle minutes</label>
                        <input type="number" min={5} value={customCycle} onChange={(e) => setCustomCycle(e.target.value)} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2 py-1.5 w-text outline-none focus:w-teal-border w-24" />
                      </div>
                      <button
                        type="button" disabled={busy === `custom-${d.deploymentId}`}
                        onClick={() => withBusy(`custom-${d.deploymentId}`, async () => {
                          const active = Number(customActive);
                          const cycle = Number(customCycle);
                          const res = await setDeploymentPresenceConfig(communityId, d.deploymentId, { activeMinutes: active, cycleMinutes: cycle });
                          if (!res.ok) throw new Error(res.error);
                          setCustomEditor(null);
                        })}
                        className="text-xs w-teal hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
