"use client";

import React, { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { sendOwnerSupportMessage } from "@/src/lib/actions/platform-support";

/** Reuses the EXISTING owner→Innvil support channel (`platform_support_
 *  messages`, already account-scoped via `getAuthedAdmin()`, not Panel-
 *  scoped) — used here for both Enterprise sales inquiries and general
 *  Settings support, rather than inventing a second contact mechanism. */
export function SupportContactForm({ defaultSubject = "", defaultBody = "" }: { defaultSubject?: string; defaultBody?: string }) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!subject.trim() || !body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendOwnerSupportMessage(subject.trim(), body.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex items-center gap-2 text-sm w-teal">
        <CheckCircle2 size={16} /> Sent — we'll follow up by email.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="How can we help?"
        rows={4}
        className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border resize-none"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={submit} disabled={busy || !subject.trim() || !body.trim()} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Send"}
      </button>
    </div>
  );
}
