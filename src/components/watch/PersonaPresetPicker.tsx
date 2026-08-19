"use client";

import React, { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { MODERATOR_PERSONA_PRESETS, type ModeratorPersonaPreset } from "@/src/lib/moderator/presets";
import { applyAccountWatcherPersonaPreset } from "@/src/lib/actions/watch-watcher-persona";
import { Modal } from "./WatchUI";

/** Focused preset library, opened from WatcherPersonaTab's compact "Current
 *  preset" summary via "Change preset" -- the full MODERATOR_PERSONA_PRESETS
 *  catalog used to sit permanently expanded in the main Persona page flow;
 *  it now lives here so choosing a starting template reads as a deliberate,
 *  occasional action rather than the page's primary task.
 *
 *  Applies the SAME action the old inline grid called
 *  (applyAccountWatcherPersonaPreset, watch-watcher-persona.ts) -- selecting
 *  a preset here mutates persona data exactly as before, just from a
 *  relocated surface. Every preset card reuses the identical markup/content
 *  the old grid used, never a redesign per preset. */
export function PersonaPresetPicker({
  moderatorId, currentPresetId, onApplied, onClose,
}: {
  moderatorId: string;
  currentPresetId: string | null;
  onApplied: (preset: ModeratorPersonaPreset) => void;
  onClose: () => void;
}) {
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (preset: ModeratorPersonaPreset) => {
    setApplying(preset.id);
    setError(null);
    const res = await applyAccountWatcherPersonaPreset(moderatorId, preset.id);
    setApplying(null);
    if (!res.ok) { setError(res.error); return; }
    onApplied(preset);
  };

  return (
    <Modal title="Choose a persona preset" onClose={onClose} maxWidth="max-w-3xl">
      <p className="text-xs w-text-faint mb-4">
        A preset is a starting template — it fills in the description and behavior instructions below, which you can
        still edit or override afterward.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[65vh] overflow-y-auto -mx-1 px-1">
        {MODERATOR_PERSONA_PRESETS.map((preset) => {
          const active = currentPresetId === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => apply(preset)}
              disabled={applying !== null}
              aria-pressed={active}
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
      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
    </Modal>
  );
}
