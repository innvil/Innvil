"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DefaultLogo } from "@/src/components/ui/BrandMark";
import { customerSignIn } from "@/src/lib/actions/customer-auth";

/* Dedicated customer login page for a panel. The default storefront also logs in
   inline on its landing card, but a purchased design's "Log in" CTA needs a real
   destination — and this mirrors the existing signup page. */

export function LoginClient({
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* On a panel host (subdomain / custom domain) the proxy already scopes "/" to this
     panel, so links must NOT carry a /p/<sub> prefix — that would route back through
     the proxy and land on Innvil. On the app host we need the prefix. */
  const base = useMemo(() => {
    if (typeof window === "undefined") return `/p/${subdomain}`;
    const host = window.location.hostname.toLowerCase();
    const root = (process.env.NEXT_PUBLIC_PANEL_ROOT_DOMAIN || "innvil.cloud").toLowerCase();
    const isAppHost =
      host === root || host === `www.${root}` || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app");
    return isAppHost ? `/p/${subdomain}` : "";
  }, [subdomain]);
  const homeHref = base || "/";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const res = await customerSignIn(panelId, email, password);
      if (!res.ok) {
        setError(res.error);
      } else {
        router.push(homeHref);
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls = embedded
    // Inherit the design's tokens so the form matches the purchased design.
    ? "w-full rounded-lg px-3 py-2.5 text-sm outline-none"
    : "w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]";
  const embeddedInputStyle = embedded
    ? { background: "var(--d-surface-alt)", border: "1px solid var(--d-border)", color: "var(--d-text)" }
    : undefined;

  const form = (
    <form onSubmit={submit} autoComplete={`section-innvil-customer-login-${panelId} on`}>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        name="email"
        autoComplete={`section-innvil-customer-login-${panelId} email`}
        placeholder="Email"
        className={`${inputCls} mb-3`}
        style={embeddedInputStyle}
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        name="password"
        autoComplete={`section-innvil-customer-login-${panelId} current-password`}
        placeholder="Password"
        className={`${inputCls} mb-4`}
        style={embeddedInputStyle}
      />

      {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

      {embedded ? (
        <button type="submit" disabled={busy} className="dz-btn dz-btn-primary" style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Please wait..." : "Log in"}
        </button>
      ) : (
        <button type="submit" disabled={busy} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
          {busy ? "Please wait..." : "Log in"}
        </button>
      )}
    </form>
  );

  if (embedded) {
    return (
      <div>
        {form}
        <div className="flex items-center justify-between mt-4 text-xs" style={{ color: "var(--d-text-faint)" }}>
          <Link href={`${base}/forgot-password`} style={{ color: "var(--d-text-faint)" }}>Forgot password?</Link>
          <span>
            New here?{" "}
            <Link href={`${base}/signup`} style={{ color: "var(--d-accent)" }}>Create account</Link>
          </span>
        </div>
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
        <h1 className="fp-display text-2xl mb-2">Log in</h1>
        <p className="fp-text-dim text-sm mb-6">Welcome back. Sign in to order and track your balance.</p>

        {form}

        <div className="flex items-center justify-between mt-4 text-xs">
          <Link href={`${base}/forgot-password`} className="fp-text-faint hover:fp-text">Forgot password?</Link>
          <span className="fp-text-faint">
            New here? <Link href={`${base}/signup`} className="fp-violet">Create account</Link>
          </span>
        </div>
      </div>
    </div>
  );
}
