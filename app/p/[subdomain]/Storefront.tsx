"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles, Zap, ShieldCheck, Wallet, Clock,
  AlertTriangle, CheckCircle2, ChevronDown,
} from "lucide-react";
import { PLATFORMS, PlatformKey, CustomerService, CustomerOrder } from "@/src/data/constants";
import { PlatformGlyph, PlatformButton } from "@/src/components/customer/PlatformIcons";
import { CustomerDashboard } from "@/src/components/customer/CustomerDashboard";
import type { PlaceOrderArgs } from "@/src/components/customer/NewOrder";
import type { StorefrontService, StorefrontPlatformMeta, PublicPaymentMethod, PublicLandingSection } from "@/src/lib/actions/storefront";
import { placeOrder, type CustomerOrderVM } from "@/src/lib/actions/orders";
import { createDeposit, getCustomerWalletSnapshot, type DepositVM } from "@/src/lib/actions/payments";
import { formatMoney } from "@/src/lib/money";
import {
  customerSignIn, customerSignOut,
  type CustomerAccountInfo,
} from "@/src/lib/actions/customer-auth";
import { rotateCustomerApiKey } from "@/src/lib/actions/customer-api";

const KNOWN = new Set<string>(PLATFORMS.map((p) => p.key));

/** Map a live storefront service to the customer UI's service shape. */
function toCustomerService(s: StorefrontService, i: number): CustomerService {
  return {
    id: s.localId ?? i + 1,
    uuid: s.id,
    platform: (s.platform ?? "") as PlatformKey, // unknown platforms render a blank glyph
    category: s.category ?? "Other",
    name: s.name,
    price: s.price,
    unit: "1k",
    min: s.min,
    max: s.max,
    startTime: "Varies",
    completion: "Varies",
    refill: false,
    cancel: false,
    drip: false,
    comments: /comment/i.test(`${s.name} ${s.category ?? ""}`),
    description: s.description ?? "",
    aliases: [],
  };
}

/** Lowercase order status → the customer UI's Title-case status. */
const ORDER_STATUS_LABEL: Record<string, CustomerOrder["status"]> = {
  pending: "Pending",
  processing: "Processing",
  in_progress: "Processing",
  partial: "Partial",
  completed: "Completed",
  canceled: "Canceled",
  failed: "Canceled",
  refunded: "Canceled",
};

function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function Storefront({
  panel,
  services,
  initialAccount,
  initialOrders = [],
  initialDeposits = [],
  platformMeta = {},
  paymentMethods = [],
  customerApiEnabled = true,
  customerApiHasKey = false,
  apiBaseUrl = "/api/v2",
}: {
  panel: { id: string; subdomain: string; name: string; status: string; currency: string; logoUrl?: string; headline?: string; description?: string; sections?: PublicLandingSection[] };
  services: StorefrontService[];
  initialAccount: CustomerAccountInfo | null;
  initialOrders?: CustomerOrderVM[];
  initialDeposits?: DepositVM[];
  platformMeta?: StorefrontPlatformMeta;
  paymentMethods?: PublicPaymentMethod[];
  customerApiEnabled?: boolean;
  customerApiHasKey?: boolean;
  apiBaseUrl?: string;
}) {
  const router = useRouter();
  const inactive = panel.status === "inactive";
  const account = initialAccount; // re-fetched by the server after auth via router.refresh()
  const fmt = (n: number) => formatMoney(n, panel.currency);
  const [liveBalance, setLiveBalance] = useState(account?.balance ?? 0);
  const [liveDeposits, setLiveDeposits] = useState(initialDeposits);

  useEffect(() => {
    setLiveBalance(account?.balance ?? 0);
  }, [account?.balance]);

  useEffect(() => {
    setLiveDeposits(initialDeposits);
  }, [initialDeposits]);

  // ---- Live data → customer dashboard shapes -------------------------------
  const uiServices = useMemo(() => services.map(toCustomerService), [services]);
  const uuidToLocalId = useMemo(() => {
    const m = new Map<string, number>();
    uiServices.forEach((s) => { if (s.uuid) m.set(s.uuid, s.id); });
    return m;
  }, [uiServices]);

  const uiOrders: CustomerOrder[] = useMemo(
    () =>
      initialOrders.map((o) => ({
        id: o.localId,
        serviceId: (o.serviceId && uuidToLocalId.get(o.serviceId)) || 0,
        serviceNo: o.serviceNo,
        service: o.serviceName,
        link: o.link,
        qty: o.quantity,
        amount: fmt(o.charge),
        status: ORDER_STATUS_LABEL[o.status] ?? "Pending",
        date: formatOrderDate(o.createdAt),
        failReason: o.failReason,
        comments: o.comments,
      })),
    [initialOrders, uuidToLocalId]
  );

  // Recently ordered — distinct service ids from the newest orders.
  const recentIds = useMemo(() => {
    const seen: number[] = [];
    for (const o of uiOrders) {
      if (o.serviceId && !seen.includes(o.serviceId)) seen.push(o.serviceId);
      if (seen.length >= 6) break;
    }
    return seen;
  }, [uiOrders]);

  const handlePlaceOrder = async (args: PlaceOrderArgs) => {
    if (!args.service.uuid) return { ok: false, error: "This service can't be ordered yet." };
    const res = await placeOrder({
      panelId: panel.id,
      serviceId: args.service.uuid,
      link: args.link,
      quantity: args.quantity,
      runs: args.runs,
      interval: args.interval,
      comments: args.comments,
    });
    if (res.ok) router.refresh();
    return { ok: res.ok, error: res.ok ? undefined : res.error };
  };

  const handleDeposit = async (amount: number, gateway?: string) => {
    const res = await createDeposit(panel.id, amount, gateway);
    return res.ok ? { ok: true, url: res.data.url } : { ok: false, error: res.error };
  };

  const rotateApiKey = async () => {
    const res = await rotateCustomerApiKey(panel.id);
    return res.ok ? { ok: true, key: res.key } : { ok: false, error: res.error };
  };

  // Deposit history → the dashboard's deposit shape.
  const DEPOSIT_STATUS_LABEL: Record<string, string> = {
    completed: "Confirmed", pending: "Pending", approved: "Approved", rejected: "Failed",
  };
  const uiDeposits = useMemo(
    () =>
      liveDeposits.map((d) => ({
        amount: `+${fmt(d.amount)}`,
        method: d.method === "crypto" ? "Crypto (Cryptomus)" : d.method,
        date: new Date(d.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }),
        status: DEPOSIT_STATUS_LABEL[d.status] ?? d.status,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveDeposits]
  );

  useEffect(() => {
    if (!account) return;
    const hasPending = liveDeposits.some((d) => d.status === "pending" || d.status === "approved");

    let cancelled = false;
    const poll = async () => {
      const next = await getCustomerWalletSnapshot(panel.id);
      if (!next || cancelled) return;
      setLiveBalance(next.balance);
      setLiveDeposits(next.deposits);
    };

    poll();
    const id = window.setInterval(poll, hasPending ? 8000 : 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [account, liveDeposits, panel.id]);

  // Group services by platform for the showcase
  const groups = useMemo(() => {
    const m = new Map<string, StorefrontService[]>();
    for (const s of services) {
      const k = s.platform && KNOWN.has(s.platform) ? s.platform : "other";
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return m;
  }, [services]);
  const platformKeys = useMemo(() => [...groups.keys()], [groups]);
  const [activeP, setActiveP] = useState("");
  const active = activeP || platformKeys[0] || "";
  const shown = (groups.get(active) ?? []).slice(0, 10);

  // Auth
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitAuth = async () => {
    if (busy) return;
    setError(null);
    if (!email || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    try {
      const res = await customerSignIn(panel.id, email, password);
      if (!res.ok) setError(res.error);
      else router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await customerSignOut();
    router.refresh();
  };

  const inputCls =
    "w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]";

  const PlatformTabs = (
    <div className="flex gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
      {platformKeys.map((k) =>
        k === "other" ? (
          <button
            key="other"
            onClick={() => setActiveP("other")}
            className={`flex flex-col items-center gap-2 shrink-0 ${active === "other" ? "fp-violet" : "fp-text-faint"}`}
          >
            <span className={`w-14 h-14 rounded-2xl border flex items-center justify-center ${active === "other" ? "fp-violet-soft-bg border-[rgba(139,127,255,0.45)]" : "fp-panel-raised border-[#262A35]"}`}>
              <Sparkles size={20} />
            </span>
            <span className="text-[11px]">Other</span>
          </button>
        ) : (
          <PlatformButton
            key={k}
            platform={k as PlatformKey}
            label={PLATFORMS.find((p) => p.key === k)?.label ?? k}
            active={active === k}
            onClick={() => setActiveP(k)}
          />
        )
      )}
    </div>
  );

  const ServiceList = (
    <div className="fp-panel border fp-line rounded-2xl p-3 sm:p-5">
      {shown.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">No services in this category yet.</p>
      ) : (
        shown.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 border-b fp-line-soft last:border-0 py-3.5 px-1">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{s.name}</p>
              <p className="text-xs fp-text-faint fp-mono mt-0.5">
                {s.category ?? "—"} · min {s.min.toLocaleString()} · max {s.max.toLocaleString()}
              </p>
            </div>
            <span className="fp-mono text-sm fp-gold shrink-0">{fmt(s.price)}/1k</span>
          </div>
        ))
      )}
    </div>
  );

  /* ---------------- Signed-in view — the real customer dashboard ---------------- */
  if (account) {
    return (
      <CustomerDashboard
        canOrder={panel.status === "live" && account.status === "active"}
        inactive={inactive}
        onLogout={logout}
        brandName={panel.name}
        logoUrl={panel.logoUrl}
        services={uiServices}
        orders={uiOrders}
        walletBalance={liveBalance}
        deposits={uiDeposits}
        tickets={[]}
        recentIds={recentIds}
        email={account.email ?? undefined}
        onPlaceOrder={handlePlaceOrder}
        onDeposit={handleDeposit}
        platformMeta={platformMeta}
        currency={panel.currency}
        paymentMethods={paymentMethods}
        panelId={panel.id}
        apiEnabled={customerApiEnabled}
        hasExistingApiKey={customerApiHasKey}
        apiBaseUrl={apiBaseUrl}
        onRotateApiKey={rotateApiKey}
      />
    );
  }

  /* ---------------- Guest landing ---------------- */
  return (
    <div className="fp-root min-h-screen fp-grid-bg fp-noise">
      {inactive && (
        <div className="fp-gold-soft-bg border-b border-[rgba(201,165,116,0.2)] px-6 py-2.5 text-center">
          <p className="fp-gold text-sm flex items-center justify-center gap-2">
            <Clock size={13} /> New orders are temporarily paused. Accounts and browsing remain available.
          </p>
        </div>
      )}

      <header className="border-b fp-line-soft bg-[#0A0B0F]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {panel.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={panel.logoUrl} alt={panel.name} className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg fp-violet-bg flex items-center justify-center">
                <Sparkles size={16} color="#0A0B0F" />
              </div>
            )}
            <span className="fp-display text-xl">{panel.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm px-4 py-2 rounded-lg fp-violet-soft-bg fp-violet">Log in</span>
            <Link href={`/p/${panel.subdomain}/signup`} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">Create account</Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 md:py-20 grid md:grid-cols-2 gap-12 items-start">
        <div>
          <h1 className="fp-display text-4xl md:text-5xl leading-tight mb-5">{panel.headline || "Grow every platform from one wallet."}</h1>
          <p className="fp-text-dim text-lg mb-8 leading-relaxed">{panel.description || `Instant delivery, transparent pricing, and one balance for all your social growth on ${panel.name}.`}</p>
          <div className="flex gap-3 flex-wrap mb-10">
            {PLATFORMS.filter((p) => groups.has(p.key)).map((p) => (
              <span key={p.key} className="w-11 h-11 rounded-xl fp-panel-raised border border-[#262A35] flex items-center justify-center fp-text-dim" title={p.label}>
                <PlatformGlyph platform={p.key} size={18} />
              </span>
            ))}
          </div>
          <div className="space-y-4">
            {[
              { icon: Zap, title: "Instant start", sub: "Most orders begin within minutes of payment." },
              { icon: Wallet, title: "One wallet", sub: "Top up once, order across every platform." },
              { icon: ShieldCheck, title: "Refill guarantee", sub: "Eligible services include automatic refill." },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg fp-violet-soft-bg fp-violet flex items-center justify-center shrink-0 mt-0.5"><f.icon size={16} /></span>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-sm fp-text-dim">{f.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div id="nb-auth" className="fp-panel border fp-line rounded-2xl p-7 max-w-md w-full md:justify-self-end">
          <h2 className="fp-display text-2xl mb-5">Welcome back</h2>
          <form
            autoComplete={`section-innvil-customer-${panel.id} on`}
            onSubmit={(e) => {
              e.preventDefault();
              submitAuth();
            }}
          >
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" autoComplete={`section-innvil-customer-${panel.id} username`} placeholder="Email" className={`${inputCls} mb-3`} />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="password" autoComplete={`section-innvil-customer-${panel.id} current-password`} placeholder="Password" className={`${inputCls} mb-2`} />
            <div className="flex justify-end mb-4">
              <Link href={`/p/${panel.subdomain}/forgot-password`} className="fp-text-faint text-xs hover:fp-text">
                Forgot password?
              </Link>
            </div>
            {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
            <button type="submit" disabled={busy} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
              {busy ? "Please wait…" : "Log in"}
            </button>
          </form>
          <p className="fp-text-faint text-xs text-center mt-4">
            New here? <Link href={`/p/${panel.subdomain}/signup`} className="fp-violet">Create account</Link>
          </p>
        </div>
      </main>

      {services.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t fp-line-soft">
          <h2 className="fp-display text-2xl mb-6 text-center">Services for every platform</h2>
          <div className="mb-6 flex justify-center">{PlatformTabs}</div>
          <div className="max-w-2xl mx-auto">{ServiceList}</div>
        </section>
      )}

      {/* Why us — default section on every panel */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t fp-line-soft">
        <h2 className="fp-display text-2xl md:text-3xl text-center mb-2">Why {panel.name}</h2>
        <p className="fp-text-dim text-sm text-center mb-10 max-w-xl mx-auto">Everything you need to grow across every platform — fast, transparent, and reliable.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Zap, t: "Instant start", d: "Most orders begin within minutes of payment." },
            { icon: ShieldCheck, t: "Refill guarantee", d: "Eligible services include automatic refills." },
            { icon: Wallet, t: "One wallet", d: "Top up once, order across every platform." },
            { icon: Clock, t: "24/7 processing", d: "Orders run around the clock, automatically." },
          ].map((f) => (
            <div key={f.t} className="fp-panel border fp-line rounded-2xl p-5">
              <span className="w-10 h-10 rounded-xl fp-gold-soft-bg fp-gold flex items-center justify-center mb-3"><f.icon size={18} /></span>
              <p className="text-sm font-medium mb-1">{f.t}</p>
              <p className="fp-text-dim text-sm leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ — default section */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-14 border-t fp-line-soft">
        <h2 className="fp-display text-2xl md:text-3xl text-center mb-8">Frequently asked</h2>
        <div className="space-y-2">
          {[
            { q: "How fast are orders delivered?", a: "Most orders start within minutes and complete based on the service's speed. Estimated times are shown before you order." },
            { q: "Is my account safe?", a: "We only ever need the public link to your post or profile — never your password." },
            { q: "How do I add funds?", a: "Create an account, open your wallet, and top up with the payment methods this panel supports." },
            { q: "What if an order drops?", a: "Eligible services include a refill guarantee — request a refill from your orders page." },
          ].map((f) => (
            <details key={f.q} className="fp-panel border fp-line rounded-xl px-4 py-3 group">
              <summary className="cursor-pointer text-sm font-medium flex items-center justify-between list-none">
                {f.q}
                <ChevronDown size={15} className="fp-text-faint group-open:rotate-180 transition-transform" />
              </summary>
              <p className="fp-text-dim text-sm mt-2 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Owner-authored landing blocks */}
      {(panel.sections ?? []).map((sec) => (
        <section key={sec.id} className="max-w-4xl mx-auto px-4 sm:px-6 py-14 border-t fp-line-soft text-center">
          {sec.title && <h2 className="fp-display text-2xl md:text-3xl mb-3">{sec.title}</h2>}
          {sec.body && <p className="fp-text-dim text-sm md:text-base max-w-2xl mx-auto whitespace-pre-line leading-relaxed">{sec.body}</p>}
          {sec.ctaLabel && (
            <a href={sec.ctaHref || "#nb-auth"} className="fp-btn-primary font-semibold px-6 py-3 rounded-lg text-sm inline-block mt-6">{sec.ctaLabel}</a>
          )}
        </section>
      ))}

      {/* CTA band — default section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t fp-line-soft">
        <div className="fp-panel border fp-gold-border rounded-2xl p-8 md:p-10 text-center">
          <h2 className="fp-display text-2xl md:text-3xl mb-3">Ready to grow on {panel.name}?</h2>
          <p className="fp-text-dim text-sm mb-6 max-w-lg mx-auto">Create your account, add funds, and place your first order in minutes.</p>
          <Link href={`/p/${panel.subdomain}/signup`} className="fp-btn-primary font-semibold px-6 py-3 rounded-lg text-sm inline-block">Create your account</Link>
        </div>
      </section>

      <footer className="border-t fp-line-soft py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-xs fp-text-faint">© 2026 {panel.name}</div>
      </footer>
    </div>
  );
}
