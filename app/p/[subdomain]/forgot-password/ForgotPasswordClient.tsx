"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { customerForgotPassword } from "@/src/lib/actions/customer-auth";

function isAppHost(hostname: string, rootDomain: string): boolean {
  const h = hostname.toLowerCase();
  const root = rootDomain.toLowerCase();
  return (
    h === root ||
    h === `www.${root}` ||
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".localhost") ||
    h.endsWith(".vercel.app")
  );
}

function buildStorefrontResetUrl(subdomain: string): string {
  const origin = window.location.origin;
  const rootDomain = process.env.NEXT_PUBLIC_PANEL_ROOT_DOMAIN || "innvil.cloud";
  const usePathRouting = isAppHost(window.location.hostname, rootDomain);
  return `${origin}${usePathRouting ? `/p/${subdomain}` : ""}/reset-password`;
}

export function ForgotPasswordClient({ panelName, subdomain }: { panelName: string; subdomain: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loginHref = useMemo(() => `/p/${subdomain}`, [subdomain]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!email) {
      setError("Enter your email.");
      return;
    }

    setBusy(true);
    try {
      const redirectTo = buildStorefrontResetUrl(subdomain);
      const res = await customerForgotPassword(email, redirectTo);
      if (!res.ok) setError(res.error);
      else setNotice("Password reset email sent. Check your inbox.");
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
        <h1 className="fp-display text-2xl mb-2">Forgot password</h1>
        <p className="fp-text-dim text-sm mb-6">Enter your account email and we will send a secure reset link.</p>

        <form onSubmit={submit} autoComplete={`section-innvil-customer-forgot-${subdomain} on`}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            name="email"
            autoComplete={`section-innvil-customer-forgot-${subdomain} email`}
            placeholder="Email"
            className={`${inputCls} mb-4`}
          />

          {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
          {notice && <p className="text-xs fp-safe mb-3 flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}

          <button type="submit" disabled={busy} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
            {busy ? "Please wait..." : "Send reset link"}
          </button>
        </form>

        <p className="fp-text-faint text-xs text-center mt-4">
          Back to <Link href={loginHref} className="fp-violet">Log in</Link>
        </p>
      </div>
    </div>
  );
}
