"use client";

import { useState } from "react";
import Link from "next/link";
import { Send, AlertTriangle, Mail } from "lucide-react";
import { AuthShell } from "@/src/components/auth/AuthShell";
import { requestPasswordReset } from "@/src/lib/actions/auth";
import type { AuthBrand } from "@/src/lib/auth/product-brand";

/**
 * Same requestPasswordReset action as before. The server action itself now
 * derives the reset-link redirect origin from the actual request host
 * (server-only, never a client-supplied param) so a reset requested from
 * watch.innvil.cloud emails a link back to watch.innvil.cloud/reset-password
 * -- see resolveAuthRedirectOrigin in src/lib/actions/auth.ts.
 */
export function ForgotPasswordPageClient({ brand }: { brand: AuthBrand }) {
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
      <AuthShell brand={brand} title="Check your inbox" footer={<Link href="/login" className={brand.accentTextClass}>Back to log in</Link>}>
        <div className="text-center py-2">
          <span className={`w-14 h-14 rounded-full ${brand.iconSoftBgClass} ${brand.iconAccentClass} flex items-center justify-center mx-auto mb-4`}><Mail size={24} /></span>
          <p className={`${brand.textDimClass} text-sm leading-relaxed`}>
            If an account exists for <span className={`${brand.id === "watch" ? "w-text" : "fp-text"} ${brand.monoClass}`}>{email}</span>, we&apos;ve sent a link to reset your password.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      brand={brand}
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={<>Remembered it? <Link href="/login" className={brand.accentTextClass}>Log in</Link></>}
    >
      <form
        autoComplete="section-innvil-owner on"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase`}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" autoComplete="section-innvil-owner email" placeholder="you@example.com" className={brand.inputClass} />
        {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
        <button type="submit" disabled={busy} className={brand.btnClass}>
          <Send size={15} /> {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}
