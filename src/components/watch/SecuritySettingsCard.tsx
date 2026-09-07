"use client";

import React, { useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { updatePassword } from "@/src/lib/actions/account";
import { SettingsRow } from "./SettingsRow";

/** Real Security section — status rows for what's actually true about this
 *  account (reusing the EXISTING `updatePassword` action from
 *  `actions/account.ts`, already production-proven in the main Innvil owner
 *  app), plus real Change Password. No session list/2FA/sign-in-method
 *  management — none of that exists anywhere in this codebase, and showing
 *  it would be exactly the "control with nothing behind it" fabrication
 *  this codebase's conventions forbid. Telegram identity is never
 *  duplicated here — it's canonically owned by Profile; this only links to
 *  it. */
export function SecuritySettingsCard({ emailVerified }: { emailVerified: boolean }) {
  const [changingPassword, setChangingPassword] = useState(false);
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
    setChangingPassword(false);
  };

  return (
    <div className="max-w-md">
      <div>
        <SettingsRow label="Password" description="Applies to your whole Innvil account, not just Watch.">
          {!changingPassword && (
            <button
              type="button"
              onClick={() => setChangingPassword(true)}
              className="text-xs w-teal hover:underline px-3 py-1.5 rounded-lg border w-line-soft"
            >
              Change password
            </button>
          )}
        </SettingsRow>

        <SettingsRow label="Email" description="Whether your account email has been confirmed.">
          <span className={`text-xs flex items-center gap-1.5 ${emailVerified ? "w-green" : "w-amber"}`}>
            {emailVerified ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {emailVerified ? "Verified" : "Not verified"}
          </span>
        </SettingsRow>

        <SettingsRow label="Sign-in method" description="The only way to sign in to your Innvil account today.">
          <span className="text-xs w-text-dim">Email & password</span>
        </SettingsRow>

        <SettingsRow label="Connected identities" description="Telegram and other connected accounts live on your Profile.">
          <Link href="/profile" className="text-xs w-teal hover:underline">Manage in Profile →</Link>
        </SettingsRow>
      </div>

      {changingPassword && (
        <div className="w-surface-raised border w-line-soft rounded-lg p-4 mt-4">
          <div className="space-y-3">
            <div>
              <label htmlFor="security-current-password" className="text-xs w-text-dim block mb-1.5">Current password</label>
              <input
                id="security-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full w-surface border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
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
                className="w-full w-surface border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
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
                className="w-full w-surface border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
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
            <button type="button" onClick={() => setChangingPassword(false)} className="text-xs w-text-faint hover:w-text">Cancel</button>
            {message && <span className="text-xs w-green">{message}</span>}
          </div>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
