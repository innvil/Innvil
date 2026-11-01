"use client";

import React, { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { currentPersonaPresetSummary, personaFieldsAfterApply, type ModeratorPersonaPreset } from "@/src/lib/moderator/presets";
import type { ModeratorPersona } from "@/src/lib/moderator/domain";
import {
  setAccountWatcherPersonaDescription, setAccountWatcherCustomInstructions,
} from "@/src/lib/actions/watch-watcher-persona";
import { PersonaPresetPicker } from "./PersonaPresetPicker";

/** Real persona/behavior editor for a standalone Watcher — the account-scoped
 *  counterpart of the owner-side PersonaPresetPicker, reusing the SAME
 *  preset catalog and the SAME materialize-onto-persona-fields mechanism
 *  (moderator/presets.ts). Customer-facing language only — never exposes
 *  raw `virtual_moderator` terminology or the numeric style dials directly.
 *
 *  Persona belongs to the Watcher profile (scoped by moderatorId end to end,
 *  via watch-watcher-persona.ts's per-Watcher ownership check) — never a
 *  Community or deployment. If this Watcher is deployed to multiple
 *  Communities, every deployment reads this SAME persona; no deployment-
 *  level override exists.
 *
 *  Page reads top-to-bottom as description -> current preset (a compact
 *  summary, not the full library) -> behavior instructions, so "configure
 *  this Watcher" reads as the primary task and "browse presets" reads as an
 *  occasional, deliberate action opened via "Change preset". The preset
 *  itself is only ever a one-time starting TEMPLATE (see applyPersonaPreset
 *  in presets.ts) — description/instructions stay fully editable afterward,
 *  and nothing here implies a manual edit is somehow invalid once a preset
 *  is applied. */
export function WatcherPersonaTab({ moderatorId, persona }: { moderatorId: string; persona: ModeratorPersona }) {
  const [applying, setApplying] = useState<"__description__" | "__instructions__" | null>(null);
  const [description, setDescription] = useState(persona.description ?? "");
  const [customInstructions, setCustomInstructions] = useState(persona.customInstructions ?? "");
  const [currentPresetId, setCurrentPresetId] = useState(persona.presetId ?? null);
  const [savedField, setSavedField] = useState<"description" | "instructions" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const activePreset = currentPersonaPresetSummary(currentPresetId);

  const saveDescription = async () => {
    setApplying("__description__");
    const res = await setAccountWatcherPersonaDescription(moderatorId, description);
    setApplying(null);
    if (res.ok) setSavedField("description");
  };

  const saveInstructions = async () => {
    setApplying("__instructions__");
    const res = await setAccountWatcherCustomInstructions(moderatorId, customInstructions);
    setApplying(null);
    if (res.ok) setSavedField("instructions");
  };

  // Mirrors exactly what the old inline grid's apply() did to local state --
  // the server-side materialization (applyPersonaPreset) writes BOTH
  // description and customInstructions from the preset's overrides, so both
  // are re-synced here too (the prior version only re-synced description,
  // leaving the Behavior instructions textarea showing stale text until a
  // reload -- a real staleness bug, fixed here since this pass already
  // touches this exact code path).
  const handleApplied = (preset: ModeratorPersonaPreset) => {
    setCurrentPresetId(preset.id);
    const fields = personaFieldsAfterApply(preset);
    if (fields.description !== undefined) setDescription(fields.description);
    if (fields.customInstructions !== undefined) setCustomInstructions(fields.customInstructions);
    setPickerOpen(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="w-card p-5">
        <h3 className="w-display text-sm mb-1">Persona description</h3>
        <p className="text-xs w-text-faint mb-3">How this Watcher describes itself when asked who it is.</p>
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
        <h3 className="w-display text-sm mb-1">Persona preset</h3>
        <p className="text-xs w-text-faint mb-3">A starting template for this Watcher's description and behavior — always editable afterward.</p>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm w-text font-medium">{activePreset ? activePreset.label : "Custom persona"}</p>
            <p className="text-xs w-text-faint mt-1">
              {activePreset ? activePreset.shortDescription : "No preset applied — description and behavior instructions are set manually."}
            </p>
            {activePreset && (
              <div className="flex flex-wrap gap-1 mt-2">
                {activePreset.tags.map((tag) => (
                  <span key={tag} className="text-[10px] w-pill w-surface w-text-faint">{tag}</span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="text-xs w-teal font-medium hover:underline shrink-0 px-3 py-1.5 rounded-lg border w-teal-border whitespace-nowrap"
          >
            Change preset
          </button>
        </div>
      </div>

      <div className="w-card p-5">
        <h3 className="w-display text-sm mb-1">Behavior instructions</h3>
        <p className="text-xs w-text-faint mb-3">Additional free-form guidance for how this Watcher should behave.</p>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          rows={4}
          placeholder="Optional — any specific behavior notes for this Watcher."
          className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border resize-y"
        />
        <div className="flex items-center gap-3 mt-2.5">
          <button onClick={saveInstructions} disabled={applying === "__instructions__"} className="w-btn-primary text-xs font-semibold px-3.5 py-1.5 rounded-lg disabled:opacity-60">
            {applying === "__instructions__" ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
          {savedField === "instructions" && <span className="text-xs w-teal flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
        </div>
      </div>

      {pickerOpen && (
        <PersonaPresetPicker
          moderatorId={moderatorId}
          currentPresetId={currentPresetId}
          onApplied={handleApplied}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
