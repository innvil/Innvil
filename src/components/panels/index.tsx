"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Wifi, ShieldCheck, Users, CreditCard, MessageSquare, Palette, Settings, Bell,
  Search, ArrowUpRight, ArrowRight, TrendingUp, Lock, CheckCircle2, Sparkles, Gauge,
  LayoutGrid, ChevronRight, Circle, Bot, Wallet, Clock, HelpCircle, ArrowLeft, X,
  Plus, History, Rocket, LogIn, Globe, Image as ImageIcon, Type, Sliders, Tag,
  Percent, Megaphone, FileText, Phone, Mail, ShoppingCart, ListOrdered, KeyRound,
  Copy, ExternalLink, ChevronDown, Activity, UserCircle2, Gift, RefreshCw,
  AlertTriangle, Wrench, Eye, EyeOff,
} from "lucide-react";
import {
  Card, StatCard, FloorLedger, RevenueChart, OrdersTable, StatusBadge,
  StatusDropdown, Toggle, Pill,
} from "@/src/components/ui";
import {
  panels, ledgerlineBalance, customers, tickets, topUpMethods, themes,
  allPanelsAdmin, PanelStatus, auditLogs,
} from "@/src/data/constants";
import { PanelAdmin } from "./admin";
import { signInAction, signUpAction, signOutAction } from "@/src/lib/actions/auth";
import { listPanels, createPanel, updatePanelStatus } from "@/src/lib/actions/panels";
import type { Panel } from "@/src/types";

/* =========================================================
   A. LEDGERLINE PUBLIC LANDING PAGE
   ========================================================= */

function TopNav({ world, setWorld }: { world: string; setWorld: (w: string) => void }) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0A0B0F]/80 border-b fp-line-soft">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md fp-gold-bg flex items-center justify-center">
            <Gauge size={15} color="#0A0B0F" />
          </div>
          <span className="fp-display text-lg tracking-wide">Innvil</span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm fp-text-dim">
          <a href="#how" className="hover:fp-text">How it works</a>
          <a href="#features" className="hover:fp-text">Features</a>
          <a href="#floor" className="hover:fp-text">Price floor</a>
          <a href="#pricing" className="hover:fp-text">Pricing</a>
        </nav>
        <div className="flex items-center gap-3">
          <button onClick={() => setWorld("auth")} className="text-sm fp-text-dim">Log in</button>
          <button onClick={() => setWorld("auth")} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
            Create your panel <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

export function PublicLanding({ setWorld }: { setWorld: (w: string) => void }) {
  return (
    <div>
      <TopNav world="public" setWorld={setWorld} />
      <section className="relative fp-noise fp-grid-bg overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 grid md:grid-cols-2 gap-14 items-center">
          <div>
            <Pill tone="violet" icon={Sparkles}>0% monthly rent · 5% commission only</Pill>
            <p className="fp-text-faint text-xs fp-mono mt-3">We build the panel maker. You bring your own provider.</p>
            <h1 className="fp-display text-5xl md:text-6xl leading-[1.05] mt-6">
              Launch your own<br />
              <span className="fp-grad-text">white-label SMM panel.</span>
            </h1>
            <p className="fp-text-dim text-base mt-6 max-w-md leading-relaxed">
              Innvil is a no-code panel maker. Create as many independent SMM panels as you
              want, each with its own subdomain, storefront, customer dashboard, and wallet —
              yours to brand, price, and grow.
            </p>
            <div className="flex items-center gap-4 mt-8">
              <button onClick={() => setWorld("auth")} className="fp-btn-primary font-semibold px-6 py-3 rounded-lg flex items-center gap-2">
                Create your panel <ArrowRight size={16} />
              </button>
              <a href="#how" className="fp-text-dim text-sm flex items-center gap-1 hover:fp-text">
                See how it works <ChevronRight size={14} />
              </a>
            </div>
            <div className="flex items-center gap-6 mt-10 fp-text-faint text-xs fp-mono">
              <span>Keep 95% of every order</span>
              <Circle size={3} fill="currentColor" />
              <span>Subdomain live in minutes</span>
            </div>
          </div>
          <FloorLedger />
        </div>
      </section>

      <section id="how" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">How it works</p>
        <h2 className="fp-display text-3xl mb-12">One account. Any number of panels.</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { n: "01", t: "Create a panel", d: "Name it, pick a subdomain, choose a theme. Live in minutes.", icon: Rocket },
            { n: "02", t: "Connect your provider", d: "Bring your own SMM provider via API. We never sell you services.", icon: Wifi },
            { n: "03", t: "Brand & price it", d: "Custom domain, your colors, your markup above the provider floor.", icon: Palette },
            { n: "04", t: "Go live", d: "Customers see your panel, not ours. You keep 95% of every order.", icon: TrendingUp },
          ].map((s) => (
            <div key={s.n} className="fp-panel border fp-line rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <span className="fp-mono text-xs fp-text-faint">{s.n}</span>
                <s.icon size={18} className="fp-gold" />
              </div>
              <h3 className="fp-display text-lg mb-2">{s.t}</h3>
              <p className="fp-text-dim text-sm leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">Provider automation</p>
        <h2 className="fp-display text-3xl mb-4">Import a thousand services in one click.</h2>
        <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-12">
          Connect your SMM provider and Innvil pulls the entire catalog, prices it with your
          markup, and organizes it for you — the busywork that eats a launch, done in seconds.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Wifi, t: "One-click catalog import", d: "Pull your provider's full service list over their API — select all, or cherry-pick." },
            { icon: Tag, t: "Auto-categorization", d: "Services are sorted into platform categories and sub-categories (Instagram → Followers, Views…) automatically." },
            { icon: Percent, t: "Markup your way", d: "Percentage, multiplier, or fixed markup above the provider floor — set once, edit any service anytime." },
            { icon: RefreshCw, t: "One-click sync", d: "Refresh prices, min/max limits, and availability from your provider whenever they change." },
            { icon: Sliders, t: "Full catalog control", d: "Rename, describe, re-price, enable or disable any service — a clean tree, not a spreadsheet." },
            { icon: ShieldCheck, t: "Keys never exposed", d: "Provider API keys are encrypted and only ever used server-side. They never touch the browser." },
          ].map((f) => (
            <div key={f.t} className="fp-panel border fp-line rounded-2xl p-6">
              <span className="w-10 h-10 rounded-xl fp-gold-soft-bg fp-gold flex items-center justify-center mb-4">
                <f.icon size={18} />
              </span>
              <h3 className="fp-display text-lg mb-2">{f.t}</h3>
              <p className="fp-text-dim text-sm leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="floor" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <div className="grid md:grid-cols-2 gap-14 items-center">
          <div>
            <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">The price floor</p>
            <h2 className="fp-display text-3xl mb-5">A floor, not a ceiling.</h2>
            <p className="fp-text-dim text-sm leading-relaxed mb-5">
              Every service on your panel inherits a minimum price equal to what your connected
              provider charges you. You price as high above it as the market allows — never below.
            </p>
            <p className="fp-text-dim text-sm leading-relaxed">
              Innvil doesn&apos;t sell SMM services or act as your provider — we build and host
              the panel. The floor simply travels with whatever price your own provider gives you.
            </p>
          </div>
          <FloorLedger compact />
        </div>
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">Pricing</p>
        <h2 className="fp-display text-3xl mb-10">One number. That&apos;s the whole model.</h2>
        <div className="fp-panel border fp-gold-border rounded-2xl p-10 max-w-xl">
          <p className="fp-display text-6xl fp-gold">5%</p>
          <p className="fp-text-dim text-sm mt-2">commission on completed orders — nothing else, ever.</p>
          <ul className="mt-6 space-y-2 text-sm">
            {["No monthly rent", "No setup fee", "Unlimited panels per account", "Subdomain included, custom domain optional"].map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 size={16} className="fp-safe shrink-0 mt-0.5" /> {t}
              </li>
            ))}
          </ul>
          <button onClick={() => setWorld("auth")} className="fp-btn-primary font-semibold px-6 py-3 rounded-lg mt-8 flex items-center gap-2">
            Create your panel <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer className="border-t fp-line-soft">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 fp-text-faint text-xs">
          <span>© 2026 Innvil — the SMM panel maker.</span>
          <div className="flex items-center gap-5">
            <a href="/terms" className="hover:fp-text">Terms</a>
            <a href="/privacy" className="hover:fp-text">Privacy</a>
            <span className="fp-mono fp-text-faint">5% commission · no rent</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* =========================================================
   B. AUTH
   ========================================================= */

export function AuthScreen({ setWorld }: { setWorld: (w: string) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: "login" | "signup") => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await signInAction(email, password)
          : await signUpAction(email, password);
      if (!res.ok) {
        setError(res.error);
      } else if (res.needsConfirmation) {
        setNotice("Check your inbox to confirm your email, then log in.");
        setMode("login");
      } else {
        setWorld("home");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fp-root min-h-screen fp-noise fp-grid-bg flex items-center justify-center px-4">
      <div className="fp-panel border fp-line rounded-2xl w-full max-w-sm p-7">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-7 h-7 rounded-md fp-gold-bg flex items-center justify-center">
            <Gauge size={15} color="#0A0B0F" />
          </div>
          <span className="fp-display text-lg">Innvil</span>
        </div>
        <div className="flex fp-panel-raised rounded-lg p-1 mb-6">
          <button
            onClick={() => switchMode("login")}
            className={`flex-1 text-sm py-2 rounded-md ${mode === "login" ? "fp-gold-bg text-[#0A0B0F] font-semibold" : "fp-text-dim"}`}
          >
            Log in
          </button>
          <button
            onClick={() => switchMode("signup")}
            className={`flex-1 text-sm py-2 rounded-md ${mode === "signup" ? "fp-gold-bg text-[#0A0B0F] font-semibold" : "fp-text-dim"}`}
          >
            Sign up
          </button>
        </div>
        <label className="fp-text-dim text-xs fp-mono uppercase">Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          name="ll-owner-email"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-form-type="other"
          placeholder="you@example.com"
          className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 mb-4 outline-none focus:fp-gold-border"
        />
        <label className="fp-text-dim text-xs fp-mono uppercase">Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          type="password"
          name="ll-owner-password"
          autoComplete="new-password"
          data-lpignore="true"
          data-1p-ignore
          data-form-type="other"
          placeholder="••••••••"
          className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 mb-4 outline-none focus:fp-gold-border"
        />
        {error && (
          <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {error}
          </p>
        )}
        {notice && (
          <p className="text-xs fp-safe mb-3 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> {notice}
          </p>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <LogIn size={15} />
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
        <p className="fp-text-faint text-xs text-center mt-5">
          {mode === "login" ? "New to Innvil?" : "Already have an account?"}{" "}
          <button onClick={() => switchMode(mode === "login" ? "signup" : "login")} className="fp-gold">
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   C. LEDGERLINE APP SHELL (dashboard)
   ========================================================= */

function AppSidebar({ section, setSection }: { section: string; setSection: (s: string) => void }) {
  const items = [
    { k: "home", label: "Dashboard home", icon: LayoutGrid },
    { k: "panels", label: "My Panels", icon: Gauge },
    { k: "billing", label: "Billing", icon: Wallet },
    { k: "orders", label: "Orders (all panels)", icon: ListOrdered },
    { k: "customers", label: "Customers (all panels)", icon: Users },
    { k: "support", label: "Support inbox", icon: MessageSquare },
  ];

  return (
    <aside className="w-60 shrink-0 fp-void-2 border-r fp-line-soft min-h-screen p-5 hidden md:flex flex-col">
      <div className="flex items-center gap-2.5 mb-10 px-1">
        <div className="w-7 h-7 rounded-md fp-gold-bg flex items-center justify-center">
          <Gauge size={15} color="#0A0B0F" />
        </div>
        <span className="fp-display text-lg">Innvil</span>
      </div>
      <nav className="space-y-1 flex-1">
        {items.map((it) => (
          <div
            key={it.k}
            onClick={() => setSection(it.k)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer ${section === it.k ? "fp-gold-soft-bg fp-gold" : "fp-text-dim hover:fp-text"}`}
          >
            <it.icon size={16} />
            {it.label}
          </div>
        ))}
      </nav>
      <div className="border-t fp-line-soft pt-4 mt-4">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm fp-text-dim">
          <Settings size={16} /> Account settings
        </div>
      </div>
    </aside>
  );
}

function AppTopbar({ setWorld }: { setWorld: (w: string) => void }) {
  return (
    <div className="flex items-center justify-between px-8 py-5 border-b fp-line-soft">
      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 fp-text-faint" />
        <input
          placeholder="Search panels, orders, customers…"
          className="w-full fp-panel border fp-line-soft rounded-lg pl-9 pr-3 py-2 text-sm fp-text placeholder:fp-text-faint outline-none focus:fp-gold-border"
        />
      </div>
      <div className="flex items-center gap-5">
        <Bell size={17} className="fp-text-dim" />
        <button
          onClick={async () => {
            await signOutAction();
            setWorld("public");
          }}
          className="fp-text-faint text-xs"
        >
          Log out
        </button>
        <div className="w-8 h-8 rounded-full fp-violet-bg flex items-center justify-center fp-mono text-xs font-semibold">KG</div>
      </div>
    </div>
  );
}

/* --- Dashboard home --- */
function DashboardHome({ panels, loading, goPanels, goCreate, openPanel }: {
  panels: Panel[];
  loading: boolean;
  goPanels: () => void;
  goCreate: () => void;
  openPanel: (p: Panel) => void;
}) {
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="fp-display text-2xl">Welcome back</h1>
        <button onClick={goCreate} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm">
          <Plus size={15} /> Create panel
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Panels created" value={loading ? "—" : String(panels.length)} />
        <StatCard label="Orders today (all panels)" value="$0.00" tone="gold" />
        <StatCard label="Innvil balance" value="$0.00" />
        <StatCard label="Commission due in 24h" value="$0.00" />
      </div>
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2"><RevenueChart title="All panels combined" /></div>
        <Card title="Recent activity" icon={Activity}>
          <p className="fp-text-dim text-sm">Activity will appear here as your panels take orders.</p>
        </Card>
      </div>
      <Card
        title="Your panels"
        icon={Gauge}
        right={<button onClick={goPanels} className="text-xs fp-gold flex items-center gap-1">View all <ChevronRight size={12} /></button>}
      >
        {loading ? (
          <p className="fp-text-faint text-sm py-6 text-center">Loading panels…</p>
        ) : panels.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm fp-text-dim mb-3">You haven&apos;t created any panels yet.</p>
            <button onClick={goCreate} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg">
              Create your first panel
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {panels.map((p) => (
              <button
                key={p.id}
                onClick={() => openPanel(p)}
                className="text-left fp-panel-raised border fp-line-soft rounded-xl p-4 hover:fp-gold-border"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">{p.name}</p>
                  <StatusBadge status={p.status} />
                </div>
                <p className="fp-text-faint text-xs fp-mono">{p.domain || `${p.subdomain}.ledgerline.app`}</p>
                <p className="fp-mono text-sm mt-3">${p.ordersToday.toFixed(2)} today</p>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* --- My Panels --- */
function MyPanels({ panels, loading, goCreate, openPanel }: {
  panels: Panel[];
  loading: boolean;
  goCreate: () => void;
  openPanel: (p: Panel) => void;
}) {
  const [panelStatuses, setPanelStatuses] = useState<Record<string, PanelStatus>>({});

  useEffect(() => {
    setPanelStatuses(
      panels.reduce((acc, p) => ({ ...acc, [p.id]: p.status }), {} as Record<string, PanelStatus>)
    );
  }, [panels]);

  const handleStatusChange = async (panelId: string, newStatus: PanelStatus) => {
    const prevStatus = panelStatuses[panelId];
    setPanelStatuses((prev) => ({ ...prev, [panelId]: newStatus })); // optimistic
    const res = await updatePanelStatus(panelId, newStatus);
    if (!res.ok) {
      setPanelStatuses((prev) => ({ ...prev, [panelId]: prevStatus })); // rollback
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="fp-display text-2xl">My Panels</h1>
        <button onClick={goCreate} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm">
          <Plus size={15} /> Create panel
        </button>
      </div>
      {loading && <p className="fp-text-faint text-sm">Loading panels…</p>}
      <div className="grid md:grid-cols-3 gap-5">
        {panels.map((p) => (
          <div key={p.id} className="fp-panel border fp-line rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="fp-display text-lg">{p.name}</p>
              <StatusDropdown
                currentStatus={panelStatuses[p.id] ?? p.status}
                onChange={(newStatus) => handleStatusChange(p.id, newStatus)}
              />
            </div>
            <p className="fp-text-faint text-xs fp-mono flex items-center gap-1">
              <Globe size={11} /> {p.domain || `${p.subdomain}.ledgerline.app`}
            </p>
            <p className="fp-text-dim text-xs mt-1">Theme: {p.theme}</p>
            <p className="fp-mono text-lg mt-4">
              ${p.ordersToday.toFixed(2)} <span className="fp-text-faint text-xs">today</span>
            </p>

            {(panelStatuses[p.id] ?? p.status) === "inactive" && (
              <div className="mt-3 p-2 rounded-lg bg-[rgba(201,165,116,0.08)] border border-[rgba(201,165,116,0.2)]">
                <p className="text-xs fp-gold flex items-center gap-1">
                  <Lock size={10} /> Inactive — orders paused
                </p>
              </div>
            )}
            {(panelStatuses[p.id] ?? p.status) === "suspended" && (
              <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle size={10} /> Suspended — contact support
                </p>
              </div>
            )}
            {(panelStatuses[p.id] ?? p.status) === "maintenance" && (
              <div className="mt-3 p-2 rounded-lg bg-[rgba(139,127,255,0.08)] border border-[rgba(139,127,255,0.2)]">
                <p className="text-xs fp-violet flex items-center gap-1">
                  <Wrench size={10} /> Maintenance in progress
                </p>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => openPanel({ ...p, status: panelStatuses[p.id] ?? p.status })}
                className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex-1"
              >
                Manage
              </button>
              <button className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim flex items-center gap-1">
                <ExternalLink size={12} /> Visit
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={goCreate}
          className="border border-dashed fp-line rounded-2xl p-5 flex flex-col items-center justify-center gap-2 fp-text-faint hover:fp-gold-border hover:fp-gold min-h-[180px]"
        >
          <Plus size={22} />
          <span className="text-sm">Create a new panel</span>
        </button>
      </div>
    </div>
  );
}

/* --- Create Panel Wizard --- */
function CreatePanelWizard({ onCreate }: {
  onCreate: (input: { name: string; subdomain: string; theme: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [theme, setTheme] = useState(themes[0].name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = ["Basics", "Theme", "Provider", "Launch"];

  const launch = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await onCreate({ name, subdomain, theme });
    if (!res.ok) {
      setError(res.error || "Could not create the panel.");
      setBusy(false);
    }
    // On success the parent navigates away; leave busy=true to avoid a flash.
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="fp-display text-2xl mb-2">Create a new panel</h1>
      <p className="fp-text-dim text-sm mb-8">
        A real, independent SMM panel — its own storefront, dashboard, and wallet.
      </p>

      <div className="flex items-center gap-2 mb-8">
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 text-xs fp-mono ${i === step ? "fp-gold" : i < step ? "fp-safe" : "fp-text-faint"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center border ${i <= step ? "fp-gold-border" : "fp-line-soft"}`}>
                {i < step ? <CheckCircle2 size={12} /> : i + 1}
              </span>
              {s}
            </div>
            {i < steps.length - 1 && <div className="flex-1 h-px fp-line" />}
          </React.Fragment>
        ))}
      </div>

      <Card>
        {step === 0 && (
          <>
            <label className="fp-text-dim text-xs fp-mono uppercase">Panel name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NovaBoost"
              className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 mb-5 outline-none focus:fp-gold-border"
            />
            <label className="fp-text-dim text-xs fp-mono uppercase">Subdomain</label>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="novaboost"
                className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border"
              />
              <span className="fp-text-faint text-sm fp-mono">.ledgerline.app</span>
            </div>
            <p className="fp-text-faint text-xs mt-2">
              You can connect a custom domain later from the panel&apos;s Domain settings.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <p className="fp-text-dim text-sm mb-4">
              Pick a starting theme — fully editable later in Design Studio.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {themes.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setTheme(t.name)}
                  className={`rounded-xl border p-4 text-left ${theme === t.name ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised"}`}
                >
                  <div className="flex gap-1.5 mb-3">
                    <span className="w-5 h-5 rounded-full border fp-line-soft" style={{ background: t.a }} />
                    <span className="w-5 h-5 rounded-full border fp-line-soft" style={{ background: t.b }} />
                  </div>
                  <p className="text-sm font-medium">{t.name}</p>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <p className="fp-text-dim text-sm mb-5">
              Connect the SMM provider you already use — or skip and do it anytime from Panel Admin.
            </p>
            <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wifi size={16} className="fp-gold" />
                <span className="text-sm">Connect provider now</span>
              </div>
              <ChevronRight size={14} className="fp-text-faint" />
            </div>
            <p className="fp-text-faint text-xs mt-3">
              Nothing is connected automatically — you choose your own provider.
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <p className="fp-text-dim text-sm mb-5">Review and launch.</p>
            <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 space-y-2 text-sm mb-5">
              <div className="flex justify-between">
                <span className="fp-text-faint">Name</span>
                <span>{name || "Untitled Panel"}</span>
              </div>
              <div className="flex justify-between">
                <span className="fp-text-faint">Subdomain</span>
                <span className="fp-mono">{subdomain || "your-panel"}.ledgerline.app</span>
              </div>
              <div className="flex justify-between">
                <span className="fp-text-faint">Theme</span>
                <span>{theme}</span>
              </div>
            </div>
          </>
        )}

        {error && (
          <p className="text-xs text-red-400 mt-5 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {error}
          </p>
        )}

        <div className="flex justify-between mt-8">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            className={`text-sm fp-text-dim flex items-center gap-1 ${step === 0 ? "opacity-0 pointer-events-none" : ""}`}
          >
            <ArrowLeft size={14} /> Back
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="fp-btn-primary font-semibold px-5 py-2.5 rounded-lg text-sm flex items-center gap-1.5"
            >
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={launch}
              disabled={busy}
              className="fp-btn-primary font-semibold px-5 py-2.5 rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Rocket size={14} /> {busy ? "Launching…" : "Launch panel"}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

/* --- Panel Admin lives in ./admin (PanelAdmin, AdminTabs, CustomerDrawer) --- */

/* --- Billing --- */
function Billing({ onAddFunds }: { onAddFunds: () => void }) {
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <h1 className="fp-display text-2xl">Billing</h1>
      <Card tone="gold">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="fp-gold" />
            <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide">Innvil balance</p>
          </div>
          <span className="fp-text-faint text-xs fp-mono">Funds commission across ALL your panels</span>
        </div>
        <p className="fp-display text-4xl fp-gold">${ledgerlineBalance.balance.toFixed(2)}</p>
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="fp-panel-raised rounded-xl p-4 border fp-line-soft">
            <p className="fp-text-faint text-xs fp-mono uppercase">Orders today (all panels)</p>
            <p className="fp-display text-xl mt-1">${ledgerlineBalance.ordersToday.toFixed(2)}</p>
          </div>
          <div className="fp-panel-raised rounded-xl p-4 border fp-line-soft">
            <p className="fp-text-faint text-xs fp-mono uppercase">Commission pending</p>
            <p className="fp-display text-xl mt-1 fp-violet">${ledgerlineBalance.commissionPending.toFixed(2)}</p>
            <p className="fp-text-faint text-[11px] mt-0.5 flex items-center gap-1">
              <Clock size={11} /> {ledgerlineBalance.feePct}% · settles in {ledgerlineBalance.chargesIn}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-6">
          <button onClick={onAddFunds} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm">
            <Plus size={15} /> Add funds
          </button>
          <button className="fp-panel-raised border fp-line-soft px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm fp-text-dim">
            <History size={15} /> History
          </button>
          <a href="#" className="text-xs fp-violet flex items-center gap-1 ml-auto">
            <HelpCircle size={13} /> How commission works?
          </a>
        </div>
        <p className="fp-text-faint text-[11px] mt-4 leading-relaxed">
          Every 24 hours we deduct 5% of that day&apos;s panel-price orders, across every panel you own,
          from this balance. If it hits $0, your panels are <span className="fp-text">not</span> suspended —
          they stay fully online and browsable, customers can still log in, view orders, tickets, and balances.
          Only new order placement pauses (Inactive Mode) until you top up. Your provider is billed by you
          directly — we never touch that relationship.
        </p>
      </Card>
      <Card title="Commission by panel today" icon={ListOrdered}>
        {panels.map((p) => (
          <div key={p.id} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3">
            <span className="text-sm">{p.name}</span>
            <span className="fp-mono text-sm">${(p.ordersToday * 0.05).toFixed(2)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function AddFundsModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState("amount");
  const [amount, setAmount] = useState("50");
  const [method, setMethod] = useState("Cryptomus");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="fp-panel border fp-line rounded-2xl w-full max-w-md p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 fp-text-faint hover:fp-text">
          <X size={18} />
        </button>
        {step === "amount" && (
          <>
            <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-1">Add funds</p>
            <h3 className="fp-display text-xl mb-6">Top up your Innvil balance</h3>
            <label className="fp-text-dim text-xs fp-mono uppercase">Amount (USD)</label>
            <div className="flex items-center gap-2 mt-2 mb-5">
              <span className="fp-display text-2xl fp-gold">$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-xl fp-display flex-1 outline-none focus:fp-gold-border"
              />
            </div>
            <div className="flex gap-2 mb-6">
              {[25, 50, 100, 250].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 text-xs fp-mono fp-text-dim hover:fp-gold-border"
                >
                  ${v}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep("method")}
              className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm"
            >
              Continue
            </button>
          </>
        )}
        {step === "method" && (
          <>
            <button onClick={() => setStep("amount")} className="fp-text-faint text-xs flex items-center gap-1 mb-4">
              <ArrowLeft size={13} /> Back
            </button>
            <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-1">Pay ${amount || "0"} via</p>
            <h3 className="fp-display text-xl mb-6">Choose a top-up method</h3>
            <div className="space-y-2 mb-6">
              {topUpMethods.map((m) => (
                <button
                  key={m.name}
                  disabled={m.status === "soon"}
                  onClick={() => setMethod(m.name)}
                  className={`w-full text-left flex items-center justify-between rounded-xl border px-4 py-3 ${
                    m.status === "soon"
                      ? "fp-line-soft opacity-40 cursor-not-allowed"
                      : method === m.name
                        ? "fp-gold-border fp-gold-soft-bg"
                        : "fp-line-soft fp-panel-raised"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="fp-text-faint text-xs mt-0.5">{m.sub}</p>
                  </div>
                  {m.status === "active" && method === m.name && <CheckCircle2 size={16} className="fp-gold" />}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep("confirm")}
              className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm"
            >
              Continue with {method}
            </button>
          </>
        )}
        {step === "confirm" && (
          <>
            <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-1">Almost there</p>
            <h3 className="fp-display text-xl mb-4">You&apos;ll be redirected to {method}</h3>
            <p className="fp-text-dim text-sm leading-relaxed mb-6">
              Complete your ${amount || "0"} payment on {method}&apos;s secure checkout.
              Your balance updates automatically — no card or wallet details ever touch our servers.
            </p>
            <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 flex items-center justify-between mb-6">
              <span className="fp-text-dim text-sm">Amount</span>
              <span className="fp-display text-lg fp-gold">${amount || "0"}</span>
            </div>
            <button onClick={onClose} className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm">
              Go to {method}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* --- Innvil App Shell wrapper --- */
export function InnvilApp({ setWorld, initialSection }: {
  setWorld: (w: string) => void;
  initialSection?: string;
}) {
  const [section, setSection] = useState(initialSection || "home");
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [panelList, setPanelList] = useState<Panel[]>([]);
  const [loadingPanels, setLoadingPanels] = useState(true);

  const refreshPanels = useCallback(async () => {
    setLoadingPanels(true);
    setPanelList(await listPanels());
    setLoadingPanels(false);
  }, []);

  useEffect(() => {
    refreshPanels();
  }, [refreshPanels]);

  const openPanel = (p: Panel) => { setActivePanel(p); setSection("panelAdmin"); };
  const goCreate = () => setSection("create");
  const goPanels = () => setSection("panels");

  const handleCreate = async (input: { name: string; subdomain: string; theme: string }) => {
    const res = await createPanel(input);
    if (!res.ok) return { ok: false, error: res.error };
    await refreshPanels();
    openPanel(res.panel); // land the owner straight in the new panel's admin
    return { ok: true };
  };

  return (
    <div className="fp-root min-h-screen flex">
      <AppSidebar section={section === "panelAdmin" || section === "create" ? "panels" : section} setSection={setSection} />
      <div className="flex-1 min-w-0">
        <AppTopbar setWorld={setWorld} />
        {section === "home" && <DashboardHome panels={panelList} loading={loadingPanels} goPanels={goPanels} goCreate={goCreate} openPanel={openPanel} />}
        {section === "panels" && <MyPanels panels={panelList} loading={loadingPanels} goCreate={goCreate} openPanel={openPanel} />}
        {section === "create" && <CreatePanelWizard onCreate={handleCreate} />}
        {section === "panelAdmin" && activePanel && <PanelAdmin panel={activePanel} setWorld={setWorld} />}
        {section === "billing" && <Billing onAddFunds={() => setShowAddFunds(true)} />}
        {section === "orders" && <div className="p-8"><OrdersTable /></div>}
        {section === "customers" && (
          <div className="p-8">
            <Card title="All customers" icon={Users}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                    <th className="py-2 font-normal">Customer</th>
                    <th className="py-2 font-normal">Panel</th>
                    <th className="py-2 font-normal">Orders</th>
                    <th className="py-2 font-normal">Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.handle} className="border-b fp-line-soft last:border-0">
                      <td className="py-3">{c.handle}</td>
                      <td className="py-3 fp-text-dim">{c.panel}</td>
                      <td className="py-3 fp-mono">{c.orders}</td>
                      <td className="py-3 fp-mono">{c.spent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}
        {section === "support" && (
          <div className="p-8">
            <Card title="Support inbox — all panels" icon={MessageSquare} right={<Pill tone="violet" icon={Bot}>Auto-reply on</Pill>}>
              <div className="space-y-3">
                {tickets.map((t) => (
                  <div key={t.subj} className="flex items-center justify-between border-b fp-line-soft last:border-0 pb-3 last:pb-0">
                    <div>
                      <p className="text-sm">{t.subj}</p>
                      <p className="fp-text-faint text-xs fp-mono mt-0.5">{t.from} · {t.time} ago</p>
                    </div>
                    <Pill tone={t.tag === "Auto-replied" ? "safe" : "gold"}>{t.tag}</Pill>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
      {showAddFunds && <AddFundsModal onClose={() => setShowAddFunds(false)} />}
    </div>
  );
}

/* === D. Customer-facing panel now lives in src/components/customer (CustomerPanel) === */

/* =========================================================
   E. SUPER ADMIN
   ========================================================= */

export function SuperAdmin() {
  const [tab, setTab] = useState("analytics");
  const [panelStatuses, setPanelStatuses] = useState<Record<string, PanelStatus>>(
    allPanelsAdmin.reduce((acc, p) => ({ ...acc, [p.name]: p.status }), {} as Record<string, PanelStatus>)
  );

  const handleStatusChange = (panelName: string, newStatus: PanelStatus) => {
    setPanelStatuses((prev) => ({ ...prev, [panelName]: newStatus }));
  };

  const tabs = [
    { k: "analytics", label: "Analytics", icon: Activity },
    { k: "platform", label: "Platform pages", icon: FileText },
    { k: "branding", label: "Innvil branding", icon: Palette },
    { k: "panels", label: "Panel management", icon: LayoutGrid },
    { k: "users", label: "User management", icon: Users },
    { k: "payments", label: "Payments & commission", icon: CreditCard },
    { k: "providers", label: "Recommended providers", icon: Wifi },
    { k: "system", label: "System & health", icon: Settings },
    { k: "audit", label: "Audit logs", icon: History },
  ];

  return (
    <div className="fp-root min-h-screen flex">
      <aside className="w-64 shrink-0 fp-void-2 border-r fp-line-soft min-h-screen p-5 hidden md:flex flex-col">
        <div className="flex items-center gap-2.5 mb-2 px-1">
          <div className="w-7 h-7 rounded-md fp-violet-bg flex items-center justify-center">
            <ShieldCheck size={15} color="#0A0B0F" />
          </div>
          <span className="fp-display text-lg">Super Admin</span>
        </div>
        <p className="fp-text-faint text-xs px-1 mb-8">Not visible to panel owners</p>
        <nav className="space-y-1 flex-1">
          {tabs.map((t) => (
            <div
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer ${tab === t.k ? "fp-violet-soft-bg fp-violet" : "fp-text-dim hover:fp-text"}`}
            >
              <t.icon size={16} />
              {t.label}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1">
        <div className="flex items-center justify-between px-8 py-5 border-b fp-line-soft">
          <p className="fp-display text-xl">Innvil · Super Admin</p>
          <Pill tone="violet" icon={Lock}>Restricted access</Pill>
        </div>

        <div className="p-8 space-y-6">
          {tab === "analytics" && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total panels" value="1,204" delta="+38 this week" tone="gold" />
                <StatCard label="Active panels" value="967" />
                <StatCard label="Orders today (platform)" value="$41,280" delta="+9%" tone="safe" />
                <StatCard label="Commission earned today" value="$2,064" />
              </div>
              <RevenueChart title="Platform-wide revenue" />
            </>
          )}

          {tab === "platform" && (
            <Card title="Public site pages" icon={FileText}>
              {["Homepage", "Features page", "Pricing page", "FAQ", "Blog", "Documentation", "Terms", "Privacy Policy"].map((p) => (
                <div key={p} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3 text-sm">
                  <span>{p}</span>
                  <button className="text-xs fp-violet flex items-center gap-1">
                    Edit <ChevronRight size={12} />
                  </button>
                </div>
              ))}
            </Card>
          )}

          {tab === "branding" && (
            <Card title="Innvil platform branding" icon={Palette}>
              <p className="fp-text-dim text-sm mb-4">
                Logo, color palette, typography, and transactional email/notification templates for the Innvil
                brand itself — separate from any individual panel&apos;s branding.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {["Logo", "Color palette", "Typography", "Email templates", "Notification templates"].map((b) => (
                  <div key={b} className="fp-panel-raised border fp-line-soft rounded-lg px-4 py-3 text-sm flex items-center justify-between">
                    {b}
                    <ChevronRight size={13} className="fp-text-faint" />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === "panels" && (
            <Card title="Every panel on Innvil" icon={LayoutGrid}>
              <div className="mb-4 p-3 rounded-lg bg-[rgba(139,127,255,0.08)] border border-[rgba(139,127,255,0.2)]">
                <p className="text-xs fp-violet">
                  <Lock size={11} className="inline mr-1" />
                  Super Admin can change any panel&apos;s status. Panel owners can only set their panels to Draft, Live, or Inactive Mode.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b border-[#1E212A]">
                    <th className="py-2 font-normal">Panel</th>
                    <th className="py-2 font-normal">Owner</th>
                    <th className="py-2 font-normal">Status</th>
                    <th className="py-2 font-normal">Verified</th>
                    <th className="py-2 font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allPanelsAdmin.map((p) => (
                    <tr key={p.name} className="border-b border-[#1E212A] last:border-0">
                      <td className="py-3">{p.name}</td>
                      <td className="py-3 fp-text-dim fp-mono text-xs">{p.owner}</td>
                      <td className="py-3">
                        <StatusDropdown
                          currentStatus={panelStatuses[p.name]}
                          onChange={(s) => handleStatusChange(p.name, s)}
                        />
                      </td>
                      <td className="py-3">
                        {p.verified ? (
                          <CheckCircle2 size={14} className="fp-safe" />
                        ) : (
                          <span className="fp-text-faint text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 flex gap-3 text-xs fp-text-dim flex-wrap">
                        <button className="fp-violet hover:fp-text flex items-center gap-1"><Eye size={11} /> Login as owner</button>
                        <button className="fp-violet hover:fp-text flex items-center gap-1"><EyeOff size={11} /> View as customer</button>
                        <button className="hover:fp-text">Suspend</button>
                        <button className="hover:fp-text">Transfer</button>
                        <button className="fp-gold hover:fp-text">Verify</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="fp-text-faint text-[11px] mt-4">&quot;Login as owner&quot; and &quot;View as customer&quot; open a read-only impersonation session for support/debugging — always logged in Audit logs.</p>
            </Card>
          )}

          {tab === "users" && (
            <Card title="Users" icon={Users}>
              {customers.map((c) => (
                <div key={c.handle} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3 text-sm">
                  <span>{c.handle}</span>
                  <div className="flex gap-3 text-xs fp-text-dim">
                    <button>Verify</button>
                    <button>Reset password</button>
                    <button className="fp-gold">Ban</button>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {tab === "payments" && (
            <div className="space-y-6">
              <Card title="Innvil top-up gateways" icon={CreditCard}>
                <p className="fp-text-dim text-sm mb-4">
                  These are the ONLY gateways panel owners use to top up their Innvil balance.
                  Distinct from the gateways panel owners configure for their own customers.
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    { n: "Cryptomus", on: true },
                    { n: "Coinbase Commerce", on: false },
                    { n: "NowPayments", on: false },
                    { n: "Stripe", on: false },
                    { n: "PayPal", on: false },
                    { n: "Bank Transfer", on: false },
                  ].map((g) => (
                    <div key={g.n} className="fp-panel-raised border fp-line-soft rounded-xl p-4 flex items-center justify-between">
                      <span className="text-sm">{g.n}</span>
                      <Toggle on={g.on} />
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Platform commission" icon={Percent}>
                <div className="flex items-center justify-between fp-panel-raised border fp-line-soft rounded-xl p-4">
                  <span className="text-sm">Global commission rate</span>
                  <span className="fp-display text-2xl fp-gold">5%</span>
                </div>
              </Card>
            </div>
          )}

          {tab === "providers" && (
            <Card title="Recommended providers list" icon={Wifi}>
              <p className="fp-text-dim text-sm mb-4">
                Shown to panel owners as optional suggestions when connecting a provider — never added automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                {["Provider A", "Provider B", "Provider C", "Provider D"].map((p) => (
                  <Pill key={p} tone="muted">{p}</Pill>
                ))}
              </div>
            </Card>
          )}

          {tab === "system" && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card title="Feature flags & maintenance" icon={Settings}>
                {["Maintenance mode", "New panel creation", "Automator add-on", "Referral system"].map((f) => (
                  <div key={f} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3 text-sm">
                    {f}
                    <Toggle on={f !== "Maintenance mode"} />
                  </div>
                ))}
              </Card>
              <Card title="Platform health" icon={Activity}>
                {[
                  { l: "API uptime (24h)", v: "99.98%", tone: "safe" as const },
                  { l: "Queue depth", v: "142 jobs", tone: "gold" as const },
                  { l: "Failed jobs (24h)", v: "3", tone: "danger" as const },
                  { l: "Webhook delivery rate", v: "99.4%", tone: "safe" as const },
                  { l: "Background workers", v: "8 / 8 online", tone: "safe" as const },
                ].map((f) => (
                  <div key={f.l} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3 text-sm">
                    {f.l}<Pill tone={f.tone}>{f.v}</Pill>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {tab === "audit" && (
            <div className="space-y-6">
              <Card title="Audit logs" icon={History}>
                {auditLogs.map((l) => (
                  <div key={l.a} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3 text-sm">
                    <span className="fp-text-dim">{l.a}</span>
                    <span className="fp-text-faint text-xs fp-mono">{l.t}</span>
                  </div>
                ))}
              </Card>
              <div className="grid md:grid-cols-2 gap-6">
                <Card title="Commission report" icon={Percent}>
                  <p className="fp-display text-3xl fp-gold">$2,064</p>
                  <p className="fp-text-faint text-xs mt-1">Commission collected today, across all panels</p>
                </Card>
                <Card title="Revenue report" icon={TrendingUp}>
                  <p className="fp-display text-3xl">$41,280</p>
                  <p className="fp-text-faint text-xs mt-1">Total panel-price order volume today</p>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
