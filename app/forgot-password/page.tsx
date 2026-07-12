"use client";

import { useState } from "react";
import Link from "next/link";
import { Send, AlertTriangle, Mail } from "lucide-react";
import { AuthShell, authInputCls } from "@/src/components/auth/AuthShell";
import { requestPasswordReset } from "@/src/lib/actions/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!email) { setError("Enter your email address."); return; }
    setBusy(true);
    try {
      const res = await requestPasswordReset(email);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your inbox" footer={<Link href="/login" className="fp-gold">Back to log in</Link>}>
        <div className="text-center py-2">
          <span className="w-14 h-14 rounded-full fp-gold-soft-bg fp-gold flex items-center justify-center mx-auto mb-4"><Mail size={24} /></span>
          <p className="fp-text-dim text-sm leading-relaxed">
            If an account exists for <span className="fp-text fp-mono">{email}</span>, we&apos;ve sent a link to reset your password.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={<>Remembered it? <Link href="/login" className="fp-gold">Log in</Link></>}
    >
      <label className="fp-text-dim text-xs fp-mono uppercase">Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="email" autoComplete="email" placeholder="you@example.com" className={authInputCls} />
      {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      <button onClick={submit} disabled={busy} className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 mt-5 disabled:opacity-60">
        <Send size={15} /> {busy ? "Sending…" : "Send reset link"}
      </button>
    </AuthShell>
  );
}
