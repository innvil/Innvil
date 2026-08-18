"use client";

import React, { useState } from "react";
import { ChevronDown, Loader2, CheckCircle2 } from "lucide-react";
import { MODERATOR_PERSONA_PRESETS, DEFAULT_SURFACED_PRESET_IDS } from "@/src/lib/moderator/presets";
import type { ModeratorPersona } from "@/src/lib/moderator/domain";
import {
  applyWatchModerationDefaultPreset, setWatchModerationDefaultDescription, setWatchModerationDefaultCustomInstructions,
} from "@/src/lib/actions/watch-moderation-defaults";

/** Real account-level Moderation Defaults editor — the SAME preset catalog
 *  and materialize-onto-persona-fields mechanism as the per-Watcher
 *  WatcherPersonaTab (moderator/presets.ts), persisted against the account
 *  instead of one specific Watcher. What's saved here is what a NEW Watcher
 *  actually starts from (createAccountWatcher, watch-runtime.ts) — this
 *  isn't a decorative preference, changing it changes real behavior for
 *  every Watcher created afterward (never retroactively — existing
 *  Watchers keep their own already-saved persona). */
export function ModerationDefaultsCard({ initial }: { initial: ModeratorPersona }) {
  const [showMore, setShowMore] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [description, setDescription] = useState(initial.description ?? "");
  const [customInstructions, setCustomInstructions] = useState(initial.customInstructions ?? "");
  const [currentPresetId, setCurrentPresetId] = useState(initial.presetId ?? null);
  const [savedField, setSavedField] = useState<"description" | "instructions" | null>(null);

  const surfaced = MODERATOR_PERSONA_PRESETS.filter((p) => DEFAULT_SURFACED_PRESET_IDS.includes(p.id));
  const visible = showMore ? MODERATOR_PERSONA_PRESETS : surfaced;
  const activePreset = currentPresetId ? MODERATOR_PERSONA_PRESETS.find((p) => p.id === currentPresetId) : null;

  const apply = async (presetId: string) => {
    setApplying(presetId);
    const res = await applyWatchModerationDefaultPreset(presetId);
    setApplying(null);
    if (res.ok) {
      setCurrentPresetId(presetId);
      const preset = MODERATOR_PERSONA_PRESETS.find((p) => p.id === presetId);
      if (preset?.overrides.description) setDescription(preset.overrides.description);
    }
  };

  const saveDescription = async () => {
    setApplying("__description__");
    const res = await setWatchModerationDefaultDescription(description);
    setApplying(null);
    if (res.ok) setSavedField("description");
  };

  const saveInstructions = async () => {
    setApplying("__instructions__");
    const res = await setWatchModerationDefaultCustomInstructions(customInstructions);
    setApplying(null);
    if (res.ok) setSavedField("instructions");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-xs w-text-faint -mt-1">
        This is the starting persona for every NEW Watcher you create. Existing Watchers keep their own persona —
        changing this never retroactively edits them.
      </p>

      <div className="w-card p-5">
        <h3 className="w-display text-sm mb-1">Default persona description</h3>
        <p className="text-xs w-text-faint mb-3">How a new Watcher describes itself when asked who it is, before you customize it further.</p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="e.g. Laid-back, friendly, concise, slightly witty."
          className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border resize-y"
        />
        <div className="flex items-center gap-3 mt-2.5">
          <button onClick={saveDescription} disabled={applying === "__description__"} className="w-btn-primary text-xs font-semibold px-3.5 py-1.5 rounded-lg disabled:opacity-60">
            {applying === "__description__" ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
          {savedField === "description" && <span className="text-xs w-teal flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
        </div>
      </div>

      <div className="w-card p-5">
        <button onClick={() => setShowMore((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left mb-1">
          <span className="w-display text-sm">
            Starting preset — {activePreset ? <span className="w-teal">{activePreset.label}</span> : "none set"}
          </span>
          <ChevronDown size={15} className={`w-text-faint transition-transform shrink-0 ${showMore ? "rotate-180" : ""}`} />
        </button>
        <p className="text-xs w-text-faint mb-3">Applying a preset updates the description and behavior below — you can still edit either afterward.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {visible.map((preset) => {
            const active = currentPresetId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => apply(preset.id)}
                disabled={applying !== null}
                className={`text-left w-surface-raised border rounded-lg p-3 disabled:opacity-60 ${active ? "w-teal-border" : "w-line-soft hover:w-teal-border"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm w-text font-medium">{preset.label}</span>
                  {applying === preset.id && <Loader2 size={12} className="animate-spin w-teal shrink-0" />}
                  {active && applying !== preset.id && <CheckCircle2 size={13} className="w-teal shrink-0" />}
                </div>
                <p className="text-[11px] w-text-faint mt-1">{preset.shortDescription}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {preset.tags.map((tag) => (
                    <span key={tag} className="text-[10px] w-pill w-surface w-text-faint">{tag}</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {!showMore && (
          <button onClick={() => setShowMore(true)} className="text-xs w-teal hover:underline mt-3">More presets</button>
        )}
      </div>

      <div className="w-card p-5">
        <h3 className="w-display text-sm mb-1">Default behavior instructions</h3>
        <p className="text-xs w-text-faint mb-3">Additional free-form guidance applied to every new Watcher's starting persona.</p>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          rows={4}
          placeholder="Optional — any specific behavior notes for new Watchers."
          className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border resize-y"
        />
        <div className="flex items-center gap-3 mt-2.5">
          <button onClick={saveInstructions} disabled={applying === "__instructions__"} className="w-btn-primary text-xs font-semibold px-3.5 py-1.5 rounded-lg disabled:opacity-60">
            {applying === "__instructions__" ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
          {savedField === "instructions" && <span className="text-xs w-teal flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
        </div>
      </div>
    </div>
  );
}
