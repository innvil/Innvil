"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { AuthShell } from "@/src/components/auth/AuthShell";
import { createClient } from "@/src/lib/supabase/client";
import type { AuthBrand } from "@/src/lib/auth/product-brand";

/** Same reset-password logic as before (exchangeCodeForSession, updateUser,
 *  router.replace("/")) -- "/" is already host-aware, so a Watch-origin
 *  reset lands back on Watch. */
export function ResetPasswordPageClient({ brand }: { brand: AuthBrand }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    (async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) { setError("This reset link is invalid or has expired."); setChecking(false); return; }
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
      else setError("Open this page from the reset link in your email.");
      setChecking(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") { setReady(true); setError(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setBusy(false); return; }
    setDone(true);
    setBusy(false);
    setTimeout(() => router.replace("/"), 1500);
  };

  if (done) {
    return (
      <AuthShell brand={brand} title="Password updated">
        <div className="text-center py-2">
          <span className={`w-14 h-14 rounded-full ${brand.successSoftBgClass} ${brand.successAccentClass} flex items-center justify-center mx-auto mb-4`}><CheckCircle2 size={24} /></span>
          <p className={`${brand.textDimClass} text-sm`}>Your password has been changed. Taking you back…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell brand={brand} title="Set a new password" footer={<Link href="/login" className={brand.accentTextClass}>Back to log in</Link>}>
      {checking ? (
        <p className={`${brand.textFaintClass} text-sm py-4 text-center`}>Verifying your reset link…</p>
      ) : !ready ? (
        <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error ?? "Invalid or expired link."}</p>
      ) : (
        <form
          autoComplete="section-innvil-owner on"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase`}>New password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="new-password" autoComplete="section-innvil-owner new-password" placeholder="At least 8 characters" className={brand.inputClass} />
          <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase mt-4 block`}>Confirm new password</label>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" name="confirm-password" autoComplete="section-innvil-owner new-password" placeholder="••••••••" className={brand.inputClass} />
          {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
          <button type="submit" disabled={busy} className={brand.btnClass}>
            <KeyRound size={15} /> {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
