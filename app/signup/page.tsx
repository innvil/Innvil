"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus, AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { AuthShell, authInputCls } from "@/src/components/auth/AuthShell";
import { signUpAction } from "@/src/lib/actions/auth";

export default function SignUpPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (username.trim().length < 2) { setError("Choose a username (at least 2 characters)."); return; }
    if (!email || !password) { setError("Enter your email and a password."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const res = await signUpAction(email, password, { displayName: username.trim() });
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      if (res.needsConfirmation) { setConfirmSent(true); setBusy(false); return; }
      router.replace("/");
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  if (confirmSent) {
    return (
      <AuthShell title="Confirm your email" footer={<Link href="/login" className="fp-gold">Back to log in</Link>}>
        <div className="text-center py-2">
          <span className="w-14 h-14 rounded-full fp-gold-soft-bg fp-gold flex items-center justify-center mx-auto mb-4"><Mail size={24} /></span>
          <p className="fp-text-dim text-sm leading-relaxed">
            We sent a confirmation link to <span className="fp-text fp-mono">{email}</span>.
            Click it to activate your account, then log in.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Launch your own white-label SMM panel."
      footer={<>Already have an account? <Link href="/login" className="fp-gold">Log in</Link></>}
    >
      <label className="fp-text-dim text-xs fp-mono uppercase">Username</label>
      <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="yourname" className={authInputCls} />
      <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" className={authInputCls} />
      <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">Password</label>
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="At least 8 characters" className={authInputCls} />
      <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">Confirm password</label>
      <input value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="password" autoComplete="new-password" placeholder="••••••••" className={authInputCls} />
      {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      <button onClick={submit} disabled={busy} className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 mt-5 disabled:opacity-60">
        <UserPlus size={15} /> {busy ? "Please wait…" : "Create account"}
      </button>
      <p className="fp-text-faint text-[11px] mt-3 flex items-center gap-1.5">
        <CheckCircle2 size={11} /> We&apos;ll email you a confirmation link to verify your address.
      </p>
    </AuthShell>
  );
}
