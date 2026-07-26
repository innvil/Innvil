"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { DefaultLogo } from "@/src/components/ui/BrandMark";
import { customerSignUp } from "@/src/lib/actions/customer-auth";
import { storefrontBaseFromLocation } from "@/src/lib/config";

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

function buildStorefrontBaseUrl(subdomain: string): string {
  const origin = window.location.origin;
  const rootDomain = process.env.NEXT_PUBLIC_PANEL_ROOT_DOMAIN || "innvil.cloud";
  const usePathRouting = isAppHost(window.location.hostname, rootDomain);
  return `${origin}${usePathRouting ? `/p/${subdomain}` : ""}`;
}

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
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    setError(null);
    setNotice(null);

    if (!username.trim()) {
      setError("Enter a username.");
      return;
    }
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    setBusy(true);
    try {
      const redirectTo = buildStorefrontBaseUrl(subdomain);
      const res = await customerSignUp(panelId, email, password, username.trim(), redirectTo);
      if (!res.ok) {
        setError(res.error);
      } else if (res.needsConfirmation) {
        setNotice("Account created. Check your email to confirm, then return and log in.");
      } else {
        router.push(loginHref);
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
    <form onSubmit={submit} autoComplete={`section-innvil-customer-signup-${panelId} on`}>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        type="text"
        name="username"
        autoComplete={`section-innvil-customer-signup-${panelId} username`}
        placeholder="Username"
        className={`${inputCls} mb-3`}
        style={embeddedInputStyle}
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        name="email"
        autoComplete={`section-innvil-customer-signup-${panelId} email`}
        placeholder="Email"
        className={`${inputCls} mb-3`}
        style={embeddedInputStyle}
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        name="password"
        autoComplete={`section-innvil-customer-signup-${panelId} new-password`}
        placeholder="Password"
        className={`${inputCls} mb-4`}
        style={embeddedInputStyle}
      />

      {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      {notice && <p className="text-xs fp-safe mb-3 flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}

      {embedded ? (
        <button type="submit" disabled={busy} className="dz-btn dz-btn-primary" style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Please wait..." : "Create account"}
        </button>
      ) : (
        <button type="submit" disabled={busy} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
          {busy ? "Please wait..." : "Create account"}
        </button>
      )}
    </form>
  );

  if (embedded) {
    return (
      <div>
        {form}
        <p className="text-xs text-center mt-4" style={{ color: "var(--d-text-faint)" }}>
          Already have an account?{" "}
          <Link href={loginHref} style={{ color: "var(--d-accent)" }}>Log in</Link>
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
        <h1 className="fp-display text-2xl mb-2">Create account</h1>
        <p className="fp-text-dim text-sm mb-6">Username, email, and password are required. We will send a confirmation email before first login.</p>

        {form}

        <p className="fp-text-faint text-xs text-center mt-4">
          Already have an account? <Link href={loginHref} className="fp-violet">Log in</Link>
        </p>
      </div>
    </div>
  );
}
