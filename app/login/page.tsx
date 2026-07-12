"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, AlertTriangle } from "lucide-react";
import { AuthShell, authInputCls } from "@/src/components/auth/AuthShell";
import { signInAction } from "@/src/lib/actions/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!email || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    try {
      const res = await signInAction(email, password);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      router.replace("/");
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Log in"
      subtitle="Welcome back to your Innvil dashboard."
      footer={<>New to Innvil? <Link href="/signup" className="fp-gold">Create an account</Link></>}
    >
      <label className="fp-text-dim text-xs fp-mono uppercase">Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" className={authInputCls} />
      <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">Password</label>
      <input value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="password" autoComplete="current-password" placeholder="••••••••" className={authInputCls} />
      <div className="text-right mt-2">
        <Link href="/forgot-password" className="fp-text-faint text-xs hover:fp-text">Forgot password?</Link>
      </div>
      {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      <button onClick={submit} disabled={busy} className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 mt-5 disabled:opacity-60">
        <LogIn size={15} /> {busy ? "Please wait…" : "Log in"}
      </button>
    </AuthShell>
  );
}
