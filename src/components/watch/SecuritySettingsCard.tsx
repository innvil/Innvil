"use client";

import React, { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { updatePassword } from "@/src/lib/actions/account";

/** Real Security section — Change Password, reusing the EXISTING
 *  `updatePassword` action (`actions/account.ts`) that already powers the
 *  main Innvil owner app's Account Settings. Zero new backend: Watch shares
 *  the same Supabase Auth session/account as every other Innvil product, so
 *  this is purely a UI entry point onto already-proven, already-secure
 *  logic (re-authenticates with the current password before allowing a
 *  change). Sign-in method is shown read-only, never as a "manage" control
 *  — no OAuth provider exists anywhere in this codebase, so email/password
 *  is genuinely the only method there is. No session list/revocation is
 *  shown — that capability doesn't exist anywhere in this codebase; showing
 *  it would be exactly the "control with nothing behind it" fabrication
 *  this codebase's conventions forbid. */
export function SecuritySettingsCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setMessage(null);
    if (newPassword !== confirmPassword) { setError("New passwords don't match."); return; }
    setSaving(true);
    const res = await updatePassword(currentPassword, newPassword);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setMessage(res.message ?? "Password changed.");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="w-surface-raised border w-line-soft rounded-lg p-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={14} className="w-teal" />
          <p className="w-text text-sm font-medium">Sign-in method</p>
        </div>
        <p className="text-xs w-text-faint">Email & password. This is the only sign-in method on your Innvil account.</p>
      </div>

      <div className="w-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={14} className="w-teal" />
          <h3 className="w-display text-sm">Change password</h3>
        </div>
        <p className="text-xs w-text-faint mb-3">Applies to your whole Innvil account, not just Watch.</p>

        <div className="space-y-3">
          <div>
            <label htmlFor="security-current-password" className="text-xs w-text-dim block mb-1.5">Current password</label>
            <input
              id="security-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
            />
          </div>
          <div>
            <label htmlFor="security-new-password" className="text-xs w-text-dim block mb-1.5">New password</label>
            <input
              id="security-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
            />
          </div>
          <div>
            <label htmlFor="security-confirm-password" className="text-xs w-text-dim block mb-1.5">Confirm new password</label>
            <input
              id="security-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={submit}
            disabled={saving || !currentPassword || !newPassword}
            className="w-btn-primary text-xs font-semibold px-3.5 py-2 rounded-lg disabled:opacity-60"
          >
            {saving ? "Saving…" : "Change password"}
          </button>
          {message && <span className="text-xs w-green">{message}</span>}
        </div>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    </div>
  );
}
