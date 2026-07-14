"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, AlertTriangle, Loader2 } from "lucide-react";
import { AuthShell, authInputCls } from "@/src/components/auth/AuthShell";
import { createClient } from "@/src/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
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
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
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
      title="Log in"
      subtitle="Welcome back to your Innvil dashboard."
      footer={<>New to Innvil? <Link href="/signup" className="fp-gold">Create an account</Link></>}
    >
      <form
        autoComplete="section-innvil-owner on"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        aria-busy={busy}
      >
        <label className="fp-text-dim text-xs fp-mono uppercase">Email</label>
        <input disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" autoComplete="section-innvil-owner username" placeholder="you@example.com" className={authInputCls} />
        <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">Password</label>
        <input disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="password" autoComplete="section-innvil-owner current-password" placeholder="••••••••" className={authInputCls} />
        <div className="text-right mt-2">
          <Link href="/forgot-password" className="fp-text-faint text-xs hover:fp-text">Forgot password?</Link>
        </div>
        {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
        <button type="submit" disabled={busy} className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 mt-5 disabled:opacity-60">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
          {busy ? (phase === "redirect" ? "Redirecting to dashboard…" : "Signing in…") : "Log in"}
        </button>
        {busy && (
          <p className="text-[11px] fp-text-faint mt-2 text-center fp-mono uppercase tracking-wide">
            {phase === "redirect" ? "Credentials verified · opening dashboard" : "Verifying credentials"}
          </p>
        )}
      </form>
    </AuthShell>
  );
}
