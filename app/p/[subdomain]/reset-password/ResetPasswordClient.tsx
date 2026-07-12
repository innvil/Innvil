"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { customerResetPassword } from "@/src/lib/actions/customer-auth";
import { createStorefrontClient } from "@/src/lib/supabase/client";

export function ResetPasswordClient({ panelName, subdomain }: { panelName: string; subdomain: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loginHref = useMemo(() => `/p/${subdomain}`, [subdomain]);
  const forgotHref = useMemo(() => `/p/${subdomain}/forgot-password`, [subdomain]);

  useEffect(() => {
    let alive = true;

    const bootstrap = async () => {
      setBootstrapping(true);
      setError(null);

      try {
        const supabase = createStorefrontClient();
        const code = searchParams.get("code");

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            if (!alive) return;
            setSessionReady(false);
            setError("Reset link is invalid or expired. Request a new reset link.");
            return;
          }
        }

        const { data } = await supabase.auth.getSession();
        if (!alive) return;

        if (!data.session) {
          setSessionReady(false);
          setError("Reset link is invalid or expired. Request a new reset link.");
          return;
        }

        setSessionReady(true);
      } catch {
        if (!alive) return;
        setSessionReady(false);
        setError("Could not verify reset link. Please request a new one.");
      } finally {
        if (!alive) return;
        setBootstrapping(false);
      }
    };

    bootstrap();
    return () => {
      alive = false;
    };
  }, [searchParams]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    if (!sessionReady) {
      setError("Reset link is invalid or expired. Request a new reset link.");
      return;
    }

    if (!password) {
      setError("Enter a new password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await customerResetPassword(password);
      if (!res.ok) setError(res.error);
      else {
        setNotice("Password updated. You can log in now.");
        setTimeout(() => {
          router.push(loginHref);
          router.refresh();
        }, 700);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]";

  return (
    <div className="fp-root min-h-screen fp-grid-bg fp-noise flex items-center justify-center px-4 py-10">
      <div className="fp-panel border fp-line rounded-2xl p-7 w-full max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-8 h-8 rounded-lg fp-violet-bg flex items-center justify-center"><Sparkles size={16} color="#0A0B0F" /></span>
          <p className="fp-display text-lg">{panelName}</p>
        </div>
        <h1 className="fp-display text-2xl mb-2">Reset password</h1>
        <p className="fp-text-dim text-sm mb-6">Set a new password for your customer account.</p>

        <form onSubmit={submit} autoComplete={`section-innvil-customer-reset-${subdomain} on`}>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            name="new-password"
            autoComplete={`section-innvil-customer-reset-${subdomain} new-password`}
            placeholder="New password"
            className={`${inputCls} mb-3`}
          />
          <input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            type="password"
            name="confirm-password"
            autoComplete={`section-innvil-customer-reset-${subdomain} new-password`}
            placeholder="Confirm new password"
            className={`${inputCls} mb-4`}
          />

          {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
          {notice && <p className="text-xs fp-safe mb-3 flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}

          <button type="submit" disabled={busy || bootstrapping || !sessionReady} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
            {bootstrapping ? "Verifying link..." : busy ? "Please wait..." : "Update password"}
          </button>
        </form>

        <p className="fp-text-faint text-xs text-center mt-4">
          Back to <Link href={loginHref} className="fp-violet">Log in</Link>
          <span className="mx-1">·</span>
          <Link href={forgotHref} className="fp-violet">Request new link</Link>
        </p>
      </div>
    </div>
  );
}
