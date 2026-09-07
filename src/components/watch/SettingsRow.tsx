"use client";

import React from "react";

/** Compact settings-row layout — label + description on the left, the real
 *  interactive control on the right — reused across General/Notifications/
 *  Security instead of each section building its own stacked form. Purely
 *  a layout shell; callers pass their own real control as children. */
export function SettingsRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b w-line-soft last:border-0">
      <div className="min-w-0 pr-4">
        <p className="w-text text-sm">{label}</p>
        {description && <p className="text-xs w-text-faint mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Shared switch control (identical visual language across Notifications
 *  and anywhere else a boolean toggle is needed) — icon+state accessible
 *  via aria-checked, never color-only (paired with the row's own label). */
export function SettingsSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`shrink-0 w-10 h-6 rounded-full relative transition-colors disabled:opacity-60 ${checked ? "w-teal-bg" : "w-surface border w-line-soft"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}
