"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus, AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { AuthShell } from "@/src/components/auth/AuthShell";
import { signUpAction } from "@/src/lib/actions/auth";
import type { AuthBrand } from "@/src/lib/auth/product-brand";

const COPY: Record<AuthBrand["id"], { title: string; subtitle: string }> = {
  innvil: { title: "Create your account", subtitle: "Launch your own white-label SMM panel." },
  watch: {
    title: "Create your Innvil account for Watch",
    subtitle: "One Innvil account gives you access to Watch and other Innvil products you choose to use.",
  },
};

/**
 * Same signup logic as before (signUpAction, router.replace("/")) -- this
 * creates the exact same shared Innvil account/profile regardless of brand;
 * only the presentation differs. Signing up here does NOT grant Watch
 * product entitlement by itself -- "/" resolves that separately afterward.
 */
export function SignUpPageClient({ brand }: { brand: AuthBrand }) {
  const router = useRouter();
  const copy = COPY[brand.id];
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
      <AuthShell brand={brand} title="Confirm your email" footer={<Link href="/login" className={brand.accentTextClass}>Back to log in</Link>}>
        <div className="text-center py-2">
          <span className={`w-14 h-14 rounded-full ${brand.iconSoftBgClass} ${brand.iconAccentClass} flex items-center justify-center mx-auto mb-4`}><Mail size={24} /></span>
          <p className={`${brand.textDimClass} text-sm leading-relaxed`}>
            We sent a confirmation link to <span className={`${brand.id === "watch" ? "w-text" : "fp-text"} ${brand.monoClass}`}>{email}</span>.
            Click it to activate your account, then log in.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      brand={brand}
      title={copy.title}
      subtitle={copy.subtitle}
      footer={<>Already have an account? <Link href="/login" className={brand.accentTextClass}>Log in</Link></>}
    >
      <form
        autoComplete="section-innvil-owner on"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase`}>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} name="username" autoComplete="section-innvil-owner username" placeholder="yourname" className={brand.inputClass} />
        <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase mt-4 block`}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" autoComplete="section-innvil-owner email" placeholder="you@example.com" className={brand.inputClass} />
        <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase mt-4 block`}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="new-password" autoComplete="section-innvil-owner new-password" placeholder="At least 8 characters" className={brand.inputClass} />
        <label className={`${brand.textDimClass} text-xs ${brand.monoClass} uppercase mt-4 block`}>Confirm password</label>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" name="confirm-password" autoComplete="section-innvil-owner new-password" placeholder="••••••••" className={brand.inputClass} />
        {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
        <button type="submit" disabled={busy} className={brand.btnClass}>
          <UserPlus size={15} /> {busy ? "Please wait…" : "Create account"}
        </button>
        <p className={`${brand.textFaintClass} text-[11px] mt-3 flex items-center gap-1.5`}>
          <CheckCircle2 size={11} /> We&apos;ll email you a confirmation link to verify your address.
        </p>
      </form>
    </AuthShell>
  );
}
