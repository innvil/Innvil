"use client";

import React, { useState } from "react";
import { ChevronDown, Loader2, CheckCircle2, RotateCcw } from "lucide-react";
import { MODERATOR_PERSONA_PRESETS, DEFAULT_SURFACED_PRESET_IDS } from "@/src/lib/moderator/presets";
import type { ModeratorPersona } from "@/src/lib/moderator/domain";
import {
  applyWatchModerationDefaultPreset, setWatchModerationDefaultDescription, setWatchModerationDefaultCustomInstructions,
  resetWatchModerationDefaults,
} from "@/src/lib/actions/watch-moderation-defaults";

/** Real account-level Moderation Defaults editor — the SAME preset catalog
 *  and materialize-onto-persona-fields mechanism as the per-Watcher
 *  WatcherPersonaTab (moderator/presets.ts), persisted against the account
 *  instead of one specific Watcher. Per explicit product decision this is
 *  NEVER silently applied to a new Watcher — every Watcher's persona is
 *  assigned individually (see the onboarding guide's "Assign a moderation
 *  persona" step, and the per-Watcher Persona tab). What's configured here
 *  is only a suggested starting point for that explicit assignment step —
 *  changing it never retroactively edits any already-configured Watcher.
 *  One flat section surface with internal dividers, not stacked cards. */
export function ModerationDefaultsCard({ initial }: { initial: ModeratorPersona }) {
  const [showMore, setShowMore] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [description, setDescription] = useState(initial.description ?? "");
  const [customInstructions, setCustomInstructions] = useState(initial.customInstructions ?? "");
  const [currentPresetId, setCurrentPresetId] = useState(initial.presetId ?? null);
  const [savedField, setSavedField] = useState<"description" | "instructions" | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const surfaced = MODERATOR_PERSONA_PRESETS.filter((p) => DEFAULT_SURFACED_PRESET_IDS.includes(p.id));
  const visible = showMore ? MODERATOR_PERSONA_PRESETS : surfaced;
  const activePreset = currentPresetId ? MODERATOR_PERSONA_PRESETS.find((p) => p.id === currentPresetId) : null;
  const isDefault = !currentPresetId && !description.trim() && !customInstructions.trim();

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

  const reset = async () => {
    setApplying("__reset__");
    const res = await resetWatchModerationDefaults();
    setApplying(null);
    setConfirmingReset(false);
    if (res.ok) {
      setCurrentPresetId(null);
      setDescription("");
      setCustomInstructions("");
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="w-surface-raised border w-teal-border rounded-lg p-3.5 mb-5">
        <p className="text-xs w-text">
          <span className="font-medium">Suggested starting persona.</span> Offered as a starting point when you assign a
          persona to a new Watcher — never applied automatically. Each Watcher's persona is assigned individually, and
          changing this never retroactively edits an already-configured Watcher.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 mb-5 pb-5 border-b w-line-soft">
        <div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Suggested starting point</p>
          <p className="text-sm w-text">
            {activePreset ? <>Preset: <span className="w-teal">{activePreset.label}</span></> : isDefault ? "Platform default (no customization)" : "Custom"}
          </p>
          {description && <p className="text-xs w-text-faint mt-1 max-w-sm truncate">"{description}"</p>}
        </div>
        {!isDefault && (
          <div>
            {confirmingReset ? (
              <div className="flex items-center gap-2">
                <span className="text-xs w-text-faint">Reset to platform default?</span>
                <button onClick={reset} disabled={applying === "__reset__"} className="text-xs text-red-400 hover:underline disabled:opacity-60">
                  {applying === "__reset__" ? "Resetting…" : "Confirm"}
                </button>
                <button onClick={() => setConfirmingReset(false)} className="text-xs w-text-faint hover:underline">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmingReset(true)} className="text-xs w-text-faint hover:w-text flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border w-line-soft">
                <RotateCcw size={12} /> Reset to Innvil defaults
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mb-5 pb-5 border-b w-line-soft">
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

      <div className="mb-5 pb-5 border-b w-line-soft">
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

      <div>
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
