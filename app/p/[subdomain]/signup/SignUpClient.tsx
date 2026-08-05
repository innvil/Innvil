"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { DefaultLogo } from "@/src/components/ui/BrandMark";
import { customerSignUp, customerVerifyOtp, customerResendOtp, customerSignIn } from "@/src/lib/actions/customer-auth";
import { storefrontBaseFromLocation } from "@/src/lib/config";

export function SignUpClient({
  panelId,
  panelName,
  subdomain,
  logoUrl,
  embedded = false,
}: {
  panelId: string;
  panelName: string;
  subdomain: string;
  logoUrl?: string | null;
  /** Render only the form — used when injected into a purchased design's auth slot. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"form" | "otp">("form");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Host-aware: "/p/<sub>" on the app host, "" on a panel host (proxy already scopes it).
  const base = useMemo(() => storefrontBaseFromLocation(subdomain), [subdomain]);
  const loginHref = `${base}/login`;
  const homeHref = base || "/";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null); setNotice(null);
    if (!username.trim()) { setError("Enter a username."); return; }
    if (!email || !password) { setError("Enter your email and password."); return; }

    setBusy(true);
    try {
      const res = await customerSignUp(panelId, email, password, username.trim());
      if (!res.ok) { setError(res.error); return; }
      setStage("otp");
      setNotice(`We emailed a 6-digit code to ${email.trim()}. Enter it to finish.`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null); setNotice(null);
    setBusy(true);
    try {
      const res = await customerVerifyOtp(panelId, email, otp);
      if (!res.ok) { setError(res.error); return; }
      // Confirmed — sign them straight in with the credentials they just used.
      const signIn = await customerSignIn(panelId, email, password);
      if (!signIn.ok) { router.push(loginHref); router.refresh(); return; }
      router.push(homeHref);
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
    try {
      const res = await customerResendOtp(panelId, email);
      setNotice(res.ok ? "A new code is on its way." : (res.ok === false ? res.error : "Couldn't resend."));
    } finally {
      setBusy(false);
    }
  };

  const inputCls = embedded
    ? "w-full rounded-lg px-3 py-2.5 text-sm outline-none"
    : "w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]";
  const embeddedInputStyle = embedded
    ? { background: "var(--d-surface-alt)", border: "1px solid var(--d-border)", color: "var(--d-text)" }
    : undefined;
  const primaryBtn = embedded ? "dz-btn dz-btn-primary" : "fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60";
  const primaryBtnStyle = embedded ? { width: "100%", justifyContent: "center" as const } : undefined;

  const signupForm = (
    <form onSubmit={submit} autoComplete={`section-innvil-customer-signup-${panelId} on`}>
      <input value={username} onChange={(e) => setUsername(e.target.value)} type="text" name="username"
        autoComplete={`section-innvil-customer-signup-${panelId} username`} placeholder="Username"
        className={`${inputCls} mb-3`} style={embeddedInputStyle} />
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email"
        autoComplete={`section-innvil-customer-signup-${panelId} email`} placeholder="Email"
        className={`${inputCls} mb-3`} style={embeddedInputStyle} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="password"
        autoComplete={`section-innvil-customer-signup-${panelId} new-password`} placeholder="Password"
        className={`${inputCls} mb-4`} style={embeddedInputStyle} />
      {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      {notice && <p className="text-xs fp-safe mb-3 flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}
      <button type="submit" disabled={busy} className={primaryBtn} style={primaryBtnStyle}>
        {busy ? "Please wait..." : "Create account"}
      </button>
    </form>
  );

  const otpForm = (
    <form onSubmit={verify}>
      <input
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6-digit code"
        className={`${inputCls} mb-4 text-center tracking-[0.5em] font-mono text-lg`}
        style={embeddedInputStyle}
      />
      {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      {notice && <p className="text-xs fp-safe mb-3 flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}
      <button type="submit" disabled={busy || otp.length !== 6} className={primaryBtn} style={primaryBtnStyle}>
        {busy ? "Verifying..." : "Verify & continue"}
      </button>
      <div className="flex items-center justify-between mt-3 text-xs">
        <button type="button" onClick={() => { setStage("form"); setOtp(""); setError(null); setNotice(null); }} className={embedded ? "" : "fp-text-faint hover:fp-text"} style={embedded ? { color: "var(--d-text-faint)" } : undefined}>← Back</button>
        <button type="button" onClick={resend} disabled={busy} className={embedded ? "" : "fp-violet"} style={embedded ? { color: "var(--d-accent)" } : undefined}>Resend code</button>
      </div>
    </form>
  );

  const active = stage === "otp" ? otpForm : signupForm;

  if (embedded) {
    return (
      <div>
        {active}
        <p className="text-xs text-center mt-4" style={{ color: "var(--d-text-faint)" }}>
          Already have an account? <Link href={loginHref} style={{ color: "var(--d-accent)" }}>Log in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="fp-root min-h-screen fp-grid-bg fp-noise flex items-center justify-center px-4 py-10">
      <div className="fp-panel border fp-line rounded-2xl p-7 w-full max-w-md">
        <Link href={homeHref} className="flex items-center gap-2 mb-2 w-fit">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={panelName} className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <DefaultLogo className="w-8 h-8 rounded-lg" iconSize={16} />
          )}
          <p className="fp-display text-lg">{panelName}</p>
        </Link>
        <h1 className="fp-display text-2xl mb-2">{stage === "otp" ? "Verify your email" : "Create account"}</h1>
        <p className="fp-text-dim text-sm mb-6">
          {stage === "otp"
            ? `Enter the 6-digit code we emailed to ${email.trim()}.`
            : "Username, email, and password are required. We'll email a verification code to finish."}
        </p>
        {active}
        <p className="fp-text-faint text-xs text-center mt-4">
          Already have an account? <Link href={loginHref} className="fp-violet">Log in</Link>
        </p>
      </div>
    </div>
  );
}
