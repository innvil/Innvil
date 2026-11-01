"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { DefaultLogo } from "@/src/components/ui/BrandMark";
import { customerForgotPassword, customerResetPassword } from "@/src/lib/actions/customer-auth";

export function ForgotPasswordClient({ panelId, panelName, subdomain }: { panelId: string; panelName: string; subdomain: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loginHref = useMemo(() => `/p/${subdomain}`, [subdomain]);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null); setNotice(null);
    if (!email) { setError("Enter your email."); return; }
    setBusy(true);
    try {
      const res = await customerForgotPassword(panelId, email);
      if (!res.ok) { setError(res.error); return; }
      setStage("reset");
      setNotice(`If an account exists for ${email.trim()}, we sent a 6-digit code.`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null); setNotice(null);
    setBusy(true);
    try {
      const res = await customerResetPassword(panelId, email, otp, password);
      if (!res.ok) { setError(res.error); return; }
      router.push(loginHref);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy) return;
    setError(null); setNotice(null);
    setBusy(true);
    try { await customerForgotPassword(panelId, email); setNotice("A new code is on its way."); }
    finally { setBusy(false); }
  };

  const inputCls =
    "w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]";

  return (
    <div className="fp-root min-h-screen fp-grid-bg fp-noise flex items-center justify-center px-4 py-10">
      <div className="fp-panel border fp-line rounded-2xl p-7 w-full max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <DefaultLogo className="w-8 h-8 rounded-lg" iconSize={16} />
          <p className="fp-display text-lg">{panelName}</p>
        </div>
        <h1 className="fp-display text-2xl mb-2">{stage === "reset" ? "Set a new password" : "Forgot password"}</h1>
        <p className="fp-text-dim text-sm mb-6">
          {stage === "reset"
            ? `Enter the 6-digit code we emailed to ${email.trim()} and choose a new password.`
            : "Enter your account email and we'll send a 6-digit reset code."}
        </p>

        {stage === "email" ? (
          <form onSubmit={request} autoComplete={`section-innvil-customer-forgot-${subdomain} on`}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email"
              autoComplete={`section-innvil-customer-forgot-${subdomain} email`} placeholder="Email" className={`${inputCls} mb-4`} />
            {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
            {notice && <p className="text-xs fp-safe mb-3 flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}
            <button type="submit" disabled={busy} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
              {busy ? "Please wait..." : "Send reset code"}
            </button>
          </form>
        ) : (
          <form onSubmit={reset}>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
              autoComplete="one-time-code" placeholder="6-digit code" className={`${inputCls} mb-3 text-center tracking-[0.5em] font-mono text-lg`} />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
              autoComplete="new-password" placeholder="New password (8+ characters)" className={`${inputCls} mb-4`} />
            {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
            {notice && <p className="text-xs fp-safe mb-3 flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}
            <button type="submit" disabled={busy || otp.length !== 6} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
              {busy ? "Please wait..." : "Reset password"}
            </button>
            <div className="flex items-center justify-between mt-3 text-xs">
              <button type="button" onClick={() => { setStage("email"); setOtp(""); setError(null); setNotice(null); }} className="fp-text-faint hover:fp-text">← Back</button>
              <button type="button" onClick={resend} disabled={busy} className="fp-violet">Resend code</button>
            </div>
          </form>
        )}

        <p className="fp-text-faint text-xs text-center mt-4">
          Back to <Link href={loginHref} className="fp-violet">Log in</Link>
        </p>
      </div>
    </div>
  );
}
