"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, AlertTriangle, Loader2 } from "lucide-react";
import { AuthShell } from "@/src/components/auth/AuthShell";
import { createClient } from "@/src/lib/supabase/client";
import type { AuthBrand } from "@/src/lib/auth/product-brand";

const COPY: Record<AuthBrand["id"], { subtitle: string; newPrompt: string; note?: string }> = {
  innvil: { subtitle: "Welcome back to your Innvil dashboard.", newPrompt: "New to Innvil?" },
  watch: {
    subtitle: "Sign in to manage your Projects, Communities, and Watchers.",
    newPrompt: "New to Watch?",
    note: "Your Innvil account works across Innvil products.",
  },
};

/**
 * Same login logic as before (createClient().auth.signInWithPassword,
 * router.replace("/")) -- this file only adds product-aware presentation.
 * "/" is already host-aware, so replacing to it lands a Watch-origin visitor
 * back on Watch (dashboard if entitled, landing otherwise) automatically --
 * no separate returnTo plumbing needed.
 */
export function LoginPageClient({ brand }: { brand: AuthBrand }) {
  const router = useRouter();
  const supabase = createClient();
  const copy = COPY[brand.id];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "auth" | "redirect">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  const submit = async () => {
    if (busy) return;
    setError(null);
    setPhase("idle");
    if (!email || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    setPhase("auth");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); setBusy(false); setPhase("idle"); return; }
      setPhase("redirect");
      router.replace("/");
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
      setPhase("idle");
    }
  };

  return (
    <AuthShell
      brand={brand}
      title="Log in"
      subtitle={copy.subtitle}
      note={copy.note}
      footer={<>{copy.newPrompt} <Link href="/signup" className={brand.accentTextClass}>Create an account</Link></>}
    >
      <form
        autoComplete="section-innvil-owner on"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        aria-busy={busy}
      >
        <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase`}>Email</label>
        <input disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" autoComplete="section-innvil-owner username" placeholder="you@example.com" className={brand.inputClass} />
        <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase mt-4 block`}>Password</label>
        <input disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="password" autoComplete="section-innvil-owner current-password" placeholder="••••••••" className={brand.inputClass} />
        <div className="text-right mt-2">
          <Link href="/forgot-password" className={`${brand.textFaintClass} text-xs hover:underline`}>Forgot password?</Link>
        </div>
        {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
        <button type="submit" disabled={busy} className={brand.btnClass}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
          {busy ? (phase === "redirect" ? "Redirecting…" : "Signing in…") : "Log in"}
        </button>
        {busy && (
          <p className={`text-[11px] ${brand.textFaintClass} mt-2 text-center ${brand.monoClass} uppercase tracking-wide`}>
            {phase === "redirect" ? "Credentials verified · opening dashboard" : "Verifying credentials"}
          </p>
        )}
      </form>
    </AuthShell>
  );
}
