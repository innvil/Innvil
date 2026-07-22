"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Wifi, ShieldCheck, Users, CreditCard, MessageSquare, Palette, Settings, Bell,
  Search, ArrowUpRight, ArrowRight, TrendingUp, Lock, CheckCircle2, Gauge,
  LayoutGrid, ChevronRight, Circle, Bot, Wallet, Clock, HelpCircle, ArrowLeft, X, Menu,
  Plus, History, Rocket, LogIn, Globe, Image as ImageIcon, Type, Sliders, Tag,
  Percent, Megaphone, FileText, Phone, Mail, ShoppingCart, ListOrdered, KeyRound,
  Copy, ExternalLink, ChevronDown, Activity, UserCircle2, Gift, RefreshCw,
  AlertTriangle, Wrench, Eye, EyeOff, Trash2, LifeBuoy, PiggyBank,
} from "lucide-react";
import {
  Card, StatCard, RevenueChart, StatusBadge,
  StatusDropdown, Toggle, Pill,
} from "@/src/components/ui";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import {
  customers, themes,
  allPanelsAdmin, PanelStatus, auditLogs,
} from "@/src/data/constants";
import { PanelAdmin } from "./admin";
import { AccountSettings } from "./AccountSettings";
import { OwnerOrders, OwnerCustomers, OwnerProviderBalances, OwnerBilling, OwnerTopUps, OwnerContactSupport, OwnerPanelSupport } from "./OwnerSections";
import { ReceiptCard } from "./ReceiptCard";
import { signInAction, signUpAction, signOutAction } from "@/src/lib/actions/auth";
import { getOwnerBillingSummary, listAllOwnerOrders, type OwnerBillingSummary, type OwnerOrderVM } from "@/src/lib/actions/admin-orders";
import { listPanels, createPanel, updatePanelStatus, deletePanel } from "@/src/lib/actions/panels";
import { amSuperAdmin } from "@/src/lib/actions/superadmin";
import { getOwnerTopupPolicy, createPlatformDeposit, type OwnerTopupPolicy } from "@/src/lib/actions/platform-payments";
import { PANEL_ROOT_DOMAIN, panelDisplayDomain, panelStorefrontPath } from "@/src/lib/config";
import type { Panel } from "@/src/types";

const OWNER_APP_CACHE_PREFIX = "innvil-owner-app";
const ownerAppMemory = new Map<string, unknown>();

function getOwnerAppCacheKey(section: string) {
  return `${OWNER_APP_CACHE_PREFIX}:${section}`;
}

function readOwnerAppCache<T>(section: string): T | null {
  const key = getOwnerAppCacheKey(section);
  if (ownerAppMemory.has(key)) return ownerAppMemory.get(key) as T;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    ownerAppMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeOwnerAppCache<T>(section: string, value: T) {
  const key = getOwnerAppCacheKey(section);
  ownerAppMemory.set(key, value);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

/* =========================================================
  A. INNVIL PUBLIC LANDING PAGE → moved to ./PublicLanding.tsx
  (its own client module so the SSR marketing page ships a slim bundle without
  the owner-app / InnvilApp code — better Core Web Vitals). Import it from
  "@/src/components/panels/PublicLanding", not from this barrel.
   ========================================================= */

/* (PublicLanding + TopNav now live in ./PublicLanding.tsx.) */

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
          <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
            <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
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
        <form
          autoComplete="section-innvil-owner on"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="fp-text-dim text-xs fp-mono uppercase">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            name="email"
            autoComplete="section-innvil-owner username"
            placeholder="you@example.com"
            className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 mb-4 outline-none focus:fp-gold-border"
          />
          <label className="fp-text-dim text-xs fp-mono uppercase">Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            type="password"
            name="password"
            autoComplete={mode === "login" ? "section-innvil-owner current-password" : "section-innvil-owner new-password"}
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
          type="submit"
          onClick={submit}
          disabled={busy}
          className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <LogIn size={15} />
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
        </form>
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
  C. INNVIL APP SHELL (dashboard)
   ========================================================= */

const APP_NAV = [
  { k: "home", label: "Dashboard home", icon: LayoutGrid },
  { k: "panels", label: "My Panels", icon: Gauge },
  { k: "billing", label: "Billing", icon: Wallet },
  { k: "earnings", label: "Earnings & receipts", icon: TrendingUp },
  { k: "orders", label: "Orders (all panels)", icon: ListOrdered },
  { k: "customers", label: "Customers (all panels)", icon: Users },
  { k: "provider-balances", label: "Provider balances", icon: PiggyBank },
  { k: "support", label: "Support inbox", icon: MessageSquare },
];

// The last nav item is role-dependent: the super admin (Innvil owner) MANAGES the
// panel owners' support messages ("Panel Support"); every other owner contacts support.
function navItemsFor(isSuper: boolean) {
  return [
    ...APP_NAV,
    { k: "contact", label: isSuper ? "Panel Support" : "Contact support", icon: LifeBuoy },
  ];
}

function AppSidebar({ section, setSection, isSuper }: { section: string; setSection: (s: string) => void; isSuper?: boolean }) {
  const items = navItemsFor(!!isSuper);

  return (
    <aside className="w-60 shrink-0 fp-void-2 border-r fp-line-soft min-h-screen p-5 hidden md:flex flex-col">
      <div className="flex items-center gap-2.5 mb-10 px-1">
        <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
          <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
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
      {isSuper && (
        <div className="border-t fp-line-soft pt-4 mt-4">
          <Link href="/superadmin" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm fp-gold hover:fp-gold-soft-bg">
            <ShieldCheck size={16} /> Super admin
          </Link>
        </div>
      )}
    </aside>
  );
}

function AppTopbar({ setWorld, onOpenAccount, onOpenNav }: { setWorld: (w: string) => void; onOpenAccount: () => void; onOpenNav: () => void }) {
  const [bellOpen, setBellOpen] = useState(false);
  const [ownerBalance, setOwnerBalance] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem("innvil-owner:billing") ?? window.localStorage.getItem("innvil-owner:billing");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { innvilBalance?: number; commissionToday?: number };
      if (typeof parsed.innvilBalance === "number") return parsed.innvilBalance;
      return typeof parsed.commissionToday === "number" ? parsed.commissionToday : null;
    } catch {
      return null;
    }
  });
  const [syncingBalance, setSyncingBalance] = useState(ownerBalance !== null);

  useEffect(() => {
    let alive = true;
    setSyncingBalance(ownerBalance !== null);
    getOwnerBillingSummary().then((summary) => {
      if (!alive) return;
      setOwnerBalance(summary.innvilBalance);
      setSyncingBalance(false);
    }).catch(() => {
      if (!alive) return;
      setSyncingBalance(false);
    });
    return () => { alive = false; };
  }, []);

  const fmtBalance = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <div className="flex items-center justify-between gap-2 px-4 sm:px-8 py-4 sm:py-5 border-b fp-line-soft">
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onOpenNav} aria-label="Open menu" className="md:hidden p-1.5 rounded-lg fp-text-dim hover:fp-text shrink-0">
          <Menu size={20} />
        </button>
        <div className="relative hidden sm:block sm:w-72 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 fp-text-faint" />
          <input
            placeholder="Search panels, orders, customers…"
            className="w-full fp-panel border fp-line-soft rounded-lg pl-9 pr-3 py-2 text-sm fp-text placeholder:fp-text-faint outline-none focus:fp-gold-border"
          />
        </div>
      </div>
      <div className="flex items-center gap-2.5 sm:gap-5 min-w-0">
        <div className="fp-panel-raised border fp-line-soft rounded-lg px-2.5 sm:px-3 py-1.5 flex items-center gap-2 shrink-0">
          <Wallet size={13} className="fp-gold" />
          <div>
            <p className="text-[10px] fp-text-faint fp-mono uppercase leading-none">Balance</p>
            <p className="text-xs fp-mono leading-tight">{ownerBalance == null ? "—" : fmtBalance(ownerBalance)}</p>
          </div>
          {syncingBalance && <RefreshCw size={11} className="fp-text-faint animate-spin" />}
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setBellOpen((o) => !o)}
            aria-label="Notifications"
            className={`p-1 rounded-lg ${bellOpen ? "fp-gold" : "fp-text-dim hover:fp-text"}`}
          >
            <Bell size={17} />
          </button>
          {bellOpen && (
            <>
              <button aria-hidden onClick={() => setBellOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div className="absolute right-0 top-full mt-2 w-72 fp-panel border fp-line rounded-xl shadow-2xl z-50 p-4">
                <p className="fp-text-faint text-xs fp-mono uppercase mb-2">Notifications</p>
                <div className="text-center py-6">
                  <CheckCircle2 size={20} className="fp-safe mx-auto mb-2" />
                  <p className="fp-text-dim text-sm">You&apos;re all caught up.</p>
                  <p className="fp-text-faint text-xs mt-1">Order and deposit alerts will appear here.</p>
                </div>
              </div>
            </>
          )}
        </div>
        <button
          onClick={onOpenAccount}
          className="fp-text-faint text-xs hidden md:flex items-center gap-1.5 hover:fp-text shrink-0"
        >
          <Settings size={14} /> Account settings
        </button>
        <button
          onClick={async () => {
            // Sign out first so the server re-render (setWorld → router.refresh) sees no session.
            await signOutAction();
            setWorld("public");
          }}
          className="fp-text-faint text-xs shrink-0"
        >
          Log out
        </button>
        <button
          onClick={onOpenAccount}
          aria-label="Account settings"
          className="w-8 h-8 rounded-full fp-violet-bg flex items-center justify-center fp-mono text-xs font-semibold hover:opacity-80 shrink-0"
        >
          <UserCircle2 size={18} className="text-[#0A0B0F]" />
        </button>
      </div>
    </div>
  );
}

/* --- Dashboard home --- */
const DASH_STATUS_TONE: Record<string, string> = {
  completed: "fp-safe", processing: "fp-gold", in_progress: "fp-gold", partial: "fp-gold",
  pending: "fp-text-dim", refunded: "text-red-400", canceled: "text-red-400", failed: "text-red-400",
  duplicate: "fp-violet",
};

function DashboardHome({ panels, loading, syncing, goPanels, goCreate, goOrders, openPanel }: {
  panels: Panel[];
  loading: boolean;
  syncing: boolean;
  goPanels: () => void;
  goCreate: () => void;
  goOrders: () => void;
  openPanel: (p: Panel) => void;
}) {
  const [summary, setSummary] = useState<OwnerBillingSummary | null>(() => readOwnerAppCache<OwnerBillingSummary>("dashboard-summary"));
  const [recent, setRecent] = useState<OwnerOrderVM[] | null>(() => readOwnerAppCache<OwnerOrderVM[]>("dashboard-recent"));

  useEffect(() => {
    let alive = true;
    getOwnerBillingSummary().then((s) => { if (!alive) return; setSummary(s); writeOwnerAppCache("dashboard-summary", s); }).catch(() => {});
    listAllOwnerOrders(8).then((r) => { if (!alive) return; setRecent(r); writeOwnerAppCache("dashboard-recent", r); }).catch(() => { if (alive) setRecent([]); });
    return () => { alive = false; };
  }, []);

  const usd = (n?: number) => `$${(Number.isFinite(n) ? (n as number) : 0).toFixed(2)}`;
  const liveCount = panels.filter((p) => p.status === "live").length;
  const revByPanel = new Map((summary?.perPanel ?? []).map((p) => [p.panelId, p.revenueToday]));

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="fp-display text-2xl">Welcome back</h1>
        <button onClick={goCreate} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm">
          <Plus size={15} /> Create panel
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Panels" value={loading ? "—" : `${liveCount}/${panels.length}`} delta={loading ? undefined : `${liveCount} live`} />
        <StatCard label="Revenue today" value={summary ? usd(summary.revenueToday) : "—"} tone="gold" />
        <StatCard label="Orders today" value={summary ? String(summary.ordersToday) : "—"} />
        <StatCard label="Innvil balance" value={summary ? usd(summary.innvilBalance) : "—"} />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card
            title="Recent orders"
            icon={ListOrdered}
            right={<button onClick={goOrders} className="text-xs fp-gold flex items-center gap-1">View all <ChevronRight size={12} /></button>}
          >
            {recent === null ? (
              <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="fp-text-faint text-sm py-6 text-center">No orders yet — they&apos;ll show here as your panels sell.</p>
            ) : (
              <div className="divide-y fp-line-soft">
                {recent.slice(0, 6).map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{o.serviceName}</p>
                      <p className="fp-text-faint text-xs fp-mono truncate">{o.panelName} · {o.customerEmail ?? o.customerUsername ?? "customer"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="fp-mono text-sm">{usd(o.charge)}</p>
                      <p className={`text-xs ${DASH_STATUS_TONE[o.status] ?? "fp-text-faint"}`}>{o.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
        <Card title="Today" icon={Activity}>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="fp-text-dim">Profit today</span><span className="fp-mono">{summary ? usd(summary.profitToday) : "—"}</span></div>
            <div className="flex justify-between"><span className="fp-text-dim">Commission charged</span><span className="fp-mono fp-gold">{summary ? usd(summary.commissionCharged) : "—"}</span></div>
            <div className="flex justify-between"><span className="fp-text-dim">Orders today</span><span className="fp-mono">{summary ? summary.ordersToday : "—"}</span></div>
            <div className="flex justify-between"><span className="fp-text-dim">Live panels</span><span className="fp-mono">{liveCount}</span></div>
          </div>
        </Card>
      </div>

      <Card
        title="Your panels"
        icon={Gauge}
        right={(
          <div className="flex items-center gap-3">
            {syncing && <span className="text-xs fp-text-faint flex items-center gap-1">Syncing…</span>}
            <button onClick={goPanels} className="text-xs fp-gold flex items-center gap-1">View all <ChevronRight size={12} /></button>
          </div>
        )}
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
                <p className="fp-text-faint text-xs fp-mono">{panelDisplayDomain(p.subdomain, p.domain)}</p>
                <p className="fp-mono text-sm mt-3">{usd(revByPanel.get(p.id))} <span className="fp-text-faint text-xs">today</span></p>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* --- My Panels --- */
// Owners set draft / live / maintenance. `inactive` (automatic, out of credit) and
// `suspended` (support-only) are shown but locked. Live is always clickable — with no
// Innvil balance the server runs it in preview (Inactive) until funds are added.
const OWNER_SETTABLE: PanelStatus[] = ["draft", "live", "maintenance"];
const LOCKED_STATUS_NOTE = {
  inactive: "Applied automatically when a panel runs out of Innvil credit.",
  suspended: "Set by Innvil support only.",
} as const;

function MyPanels({ panels, loading, syncing, goCreate, openPanel, onChanged }: {
  panels: Panel[];
  loading: boolean;
  syncing: boolean;
  goCreate: () => void;
  openPanel: (p: Panel) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [panelStatuses, setPanelStatuses] = useState<Record<string, PanelStatus>>({});
  const [statusError, setStatusError] = useState<Record<string, string>>({});
  const [statusNote, setStatusNote] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Panel | null>(null);

  useEffect(() => {
    setPanelStatuses(
      panels.reduce((acc, p) => ({ ...acc, [p.id]: p.status }), {} as Record<string, PanelStatus>)
    );
  }, [panels]);

  const handleStatusChange = async (panelId: string, newStatus: PanelStatus) => {
    const prevStatus = panelStatuses[panelId];
    setStatusError((prev) => ({ ...prev, [panelId]: "" }));
    setStatusNote((prev) => ({ ...prev, [panelId]: "" }));
    setPanelStatuses((prev) => ({ ...prev, [panelId]: newStatus })); // optimistic
    const res = await updatePanelStatus(panelId, newStatus);
    if (!res.ok) {
      setPanelStatuses((prev) => ({ ...prev, [panelId]: prevStatus })); // rollback
      setStatusError((prev) => ({ ...prev, [panelId]: res.error }));
      return;
    }
    // The server may downgrade Live → Inactive (preview) when there's no balance.
    setPanelStatuses((prev) => ({ ...prev, [panelId]: res.status }));
    if (res.note) setStatusNote((prev) => ({ ...prev, [panelId]: res.note as string }));
  };

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="fp-display text-2xl">My Panels</h1>
        <div className="flex items-center gap-3">
          {syncing && <span className="text-xs fp-text-faint">Syncing…</span>}
          <button onClick={goCreate} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm">
            <Plus size={15} /> Create panel
          </button>
        </div>
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
                settable={OWNER_SETTABLE}
                lockedNote={LOCKED_STATUS_NOTE}
              />
            </div>
            {statusError[p.id] && (
              <p className="text-xs text-red-400 flex items-start gap-1 mb-2">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {statusError[p.id]}
              </p>
            )}
            {statusNote[p.id] && !statusError[p.id] && (
              <p className="text-xs fp-gold flex items-start gap-1 mb-2">
                <Clock size={11} className="mt-0.5 shrink-0" /> {statusNote[p.id]}
              </p>
            )}
            <p className="fp-text-faint text-xs fp-mono flex items-center gap-1">
              <Globe size={11} /> {panelDisplayDomain(p.subdomain, p.domain)}
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
              <a
                href={panelStorefrontPath(p.subdomain, p.domain)}
                target="_blank"
                rel="noopener noreferrer"
                className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim flex items-center gap-1 hover:fp-gold-border"
              >
                <ExternalLink size={12} /> Visit
              </a>
              <button
                onClick={() => setConfirmDelete({ ...p, status: panelStatuses[p.id] ?? p.status })}
                aria-label="Delete panel"
                title="Delete panel"
                className="fp-panel-raised border border-red-500/25 text-xs px-2.5 py-2 rounded-lg text-red-400/80 hover:text-red-400 hover:border-red-500/50 flex items-center"
              >
                <Trash2 size={13} />
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

      {confirmDelete && (
        <DeletePanelModal
          panel={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDeleted={async () => { setConfirmDelete(null); await onChanged(); }}
        />
      )}
    </div>
  );
}

/* --- Delete Panel (with caution) --- */
function DeletePanelModal({ panel, onClose, onDeleted }: {
  panel: Panel;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = confirmText.trim().toLowerCase() === panel.subdomain.toLowerCase();

  const remove = async () => {
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    const res = await deletePanel(panel.id, confirmText);
    if (!res.ok) { setError(res.error); setBusy(false); return; }
    await onDeleted();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="relative fp-panel border border-red-500/30 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-9 h-9 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center"><Trash2 size={16} /></span>
          <p className="fp-display text-lg">Delete this panel?</p>
        </div>
        <p className="fp-text-dim text-sm leading-relaxed mb-3">
          <span className="fp-text">{panel.name}</span> and <span className="fp-text">everything under it</span> —
          customers, orders, services, providers, wallet balances, tickets and deposits — will be
          permanently removed. <span className="text-red-400">This cannot be undone.</span>
        </p>
        <label className="fp-text-dim text-xs fp-mono uppercase">
          Type <span className="fp-gold">{panel.subdomain}</span> to confirm
        </label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && remove()}
          autoFocus
          placeholder={panel.subdomain}
          className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 mb-4 outline-none focus:border-red-500/50 fp-mono"
        />
        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5 mb-3"><AlertTriangle size={12} /> {error}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={remove}
            disabled={!armed || busy}
            className="flex-1 bg-red-500/90 hover:bg-red-500 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <Trash2 size={14} /> {busy ? "Deleting…" : "Delete permanently"}
          </button>
          <button onClick={onClose} disabled={busy} className="fp-panel-raised border fp-line-soft px-4 py-2.5 rounded-lg text-sm fp-text-dim">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* --- Create Panel Wizard --- */
function CreatePanelWizard({ onCreate }: {
  onCreate: (input: { name: string; subdomain: string; theme: string; connectProvider: boolean }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [theme, setTheme] = useState(themes[0].name);
  const [connectProvider, setConnectProvider] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = ["Basics", "Theme", "Provider", "Launch"];

  const launch = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await onCreate({ name, subdomain, theme, connectProvider });
    if (!res.ok) {
      setError(res.error || "Could not create the panel.");
      setBusy(false);
    }
    // On success the parent navigates away; leave busy=true to avoid a flash.
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
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
              <span className="fp-text-faint text-sm fp-mono">.{PANEL_ROOT_DOMAIN}</span>
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
              You enter your provider&apos;s API URL and key on the next screen (Providers &amp; API).
            </p>
            <button
              type="button"
              onClick={() => setConnectProvider((v) => !v)}
              className={`w-full fp-panel-raised border rounded-xl p-4 flex items-center justify-between text-left transition-colors ${connectProvider ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft"}`}
            >
              <div className="flex items-center gap-3">
                <Wifi size={16} className="fp-gold" />
                <div>
                  <p className="text-sm">Take me to provider setup after launch</p>
                  <p className="fp-text-faint text-xs mt-0.5">Opens the panel straight on the Providers &amp; API tab.</p>
                </div>
              </div>
              <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${connectProvider ? "fp-gold-border fp-gold" : "fp-line-soft"}`}>
                {connectProvider && <CheckCircle2 size={13} />}
              </span>
            </button>
            <p className="fp-text-faint text-xs mt-3">
              Nothing is connected automatically — you always choose and enter your own provider.
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
                <span className="fp-mono">{subdomain || "your-panel"}.{PANEL_ROOT_DOMAIN}</span>
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

/* --- Billing lives in ./OwnerSections (OwnerBilling — real cross-panel figures) --- */

function AddFundsModal({
  onClose,
  initialPolicy,
  initialInnvilBalance,
  panels,
}: {
  onClose: () => void;
  initialPolicy: OwnerTopupPolicy | null;
  initialInnvilBalance: number | null;
  panels: Panel[];
}) {
  const pickDiscountRule = (value: number, rules: Array<{ minAmount: number; discountPct: number }>) => {
    if (!Number.isFinite(value) || value <= 0 || rules.length === 0) return null;
    let picked: { minAmount: number; discountPct: number } | null = null;
    for (const r of rules) {
      if (value >= r.minAmount) picked = r;
      else break;
    }
    return picked;
  };

  const [step, setStep] = useState("amount");
  const [amount, setAmount] = useState("50");
  const [method, setMethod] = useState("");
  const [panelId, setPanelId] = useState<string>(panels[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<OwnerTopupPolicy | null>(initialPolicy);
  const [innvilBalance, setInnvilBalance] = useState<number | null>(initialInnvilBalance);
  const [error, setError] = useState<string | null>(null);

  const goToCheckout = async () => {
    if (!panelId) { setError("Create a panel first, then top up its Innvil balance."); return; }
    if (!method) { setError("Choose a payment method."); return; }
    setBusy(true); setError(null);
    const res = await createPlatformDeposit(panelId, Number(amount), method);
    if (!res.ok) { setError(res.error); setBusy(false); return; }
    window.location.href = res.url; // gateway checkout — keep busy through redirect
  };

  useEffect(() => {
    if (policy) {
      if (!method) setMethod(policy.methods[0]?.id ?? "");
      return;
    }
    let alive = true;
    setBusy(true);
    Promise.all([getOwnerTopupPolicy(), getOwnerBillingSummary()]).then(([nextPolicy, summary]) => {
      if (!alive) return;
      setPolicy(nextPolicy);
      setMethod(nextPolicy.methods[0]?.id ?? "");
      setInnvilBalance(summary.innvilBalance);
      setBusy(false);
    }).catch(() => {
      if (!alive) return;
      setBusy(false);
      setError("Could not load payment methods right now.");
    });
    return () => { alive = false; };
  }, [policy, method]);

  const methodMeta = policy?.methods.find((m) => m.id === method) ?? null;
  const normalizedAmount = Number(amount);
  const firstTopup = (innvilBalance ?? 0) <= 0;
  const minTopup = firstTopup ? (policy?.firstTopupMin ?? 10) : (policy?.minTopup ?? 5);
  const methodRules = [...(methodMeta?.discountRules ?? [])].sort((a, b) => a.minAmount - b.minAmount);
  const appliedRule = pickDiscountRule(normalizedAmount, methodRules);
  const bonusAmount = appliedRule ? Math.round((normalizedAmount * (appliedRule.discountPct / 100)) * 10000) / 10000 : 0;
  const creditedAmount = Number.isFinite(normalizedAmount) ? Math.round((normalizedAmount + bonusAmount) * 10000) / 10000 : 0;

  const continueToMethod = () => {
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (normalizedAmount < minTopup) {
      setError(`Minimum top-up is $${minTopup.toFixed(2)}${firstTopup ? " for your first top-up" : ""}.`);
      return;
    }
    setError(null);
    setStep("method");
  };

  const continueToConfirm = () => {
    if (!method) {
      setError("Choose a payment method.");
      return;
    }
    setError(null);
    setStep("confirm");
  };

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
            {panels.length > 1 ? (
              <div className="mb-5">
                <label className="fp-text-dim text-xs fp-mono uppercase">Fund which panel</label>
                <select value={panelId} onChange={(e) => setPanelId(e.target.value)} className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm mt-1.5 outline-none focus:fp-gold-border">
                  {panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            ) : panels.length === 1 ? (
              <p className="fp-text-faint text-xs mb-4">Funding <span className="fp-text">{panels[0].name}</span>&apos;s Innvil balance.</p>
            ) : (
              <p className="text-xs text-red-400 mb-4">Create a panel first, then top up its Innvil balance.</p>
            )}
            <label className="fp-text-dim text-xs fp-mono uppercase">Amount (USD)</label>
            <div className="flex items-center gap-2 mt-2 mb-5">
              <span className="fp-display text-2xl fp-gold">$</span>
              <input
                value={amount}
                onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setError(null); }}
                className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-xl fp-display flex-1 outline-none focus:fp-gold-border"
              />
            </div>
            <p className="fp-text-faint text-xs mb-3">
              Minimum top-up: <span className="fp-text">${minTopup.toFixed(2)}</span>
              {firstTopup ? " (first top-up)" : ""}
            </p>
            {methodMeta && methodRules.length > 0 && (
              <details className="fp-panel-raised border fp-line-soft rounded-lg p-3 mb-4">
                <summary className="cursor-pointer fp-text-dim text-xs">
                  Promo tiers ({methodMeta.label})
                </summary>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {methodRules.map((r) => (
                    <div key={`${r.minAmount}-${r.discountPct}`} className="text-xs fp-text-faint border fp-line-soft rounded-md px-2 py-1.5">
                      Top-up ≥ <span className="fp-text">${r.minAmount.toFixed(2)}</span> → <span className="fp-safe">+{r.discountPct}%</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {appliedRule && Number.isFinite(normalizedAmount) && normalizedAmount > 0 && (
              <p className="fp-safe text-xs mb-4">
                You pay ${normalizedAmount.toFixed(2)} + bonus ${bonusAmount.toFixed(2)} = ${creditedAmount.toFixed(2)} credited
              </p>
            )}
            <div className="flex gap-2 mb-6">
              {[25, 50, 100, 250].map((v) => (
                <button
                  key={v}
                  onClick={() => { setAmount(String(v)); setError(null); }}
                  className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 text-xs fp-mono fp-text-dim hover:fp-gold-border"
                >
                  ${v}
                </button>
              ))}
            </div>
            {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
            <button
              onClick={continueToMethod}
              disabled={busy || !policy}
              className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm disabled:opacity-60 disabled:cursor-not-allowed"
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
              {(policy?.methods ?? []).map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setMethod(m.id); setError(null); }}
                  className={`w-full text-left flex items-center justify-between rounded-xl border px-4 py-3 ${
                    method === m.id ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{m.label}</p>
                    <p className="fp-text-faint text-xs mt-0.5">{m.note}</p>
                    {m.discountRules.length > 0 && (
                      <p className="fp-safe text-[11px] mt-1">{m.discountRules.length} promo tier{m.discountRules.length === 1 ? "" : "s"} available</p>
                    )}
                  </div>
                  {method === m.id && <CheckCircle2 size={16} className="fp-gold" />}
                </button>
              ))}
            </div>
            {(!policy || policy.methods.length === 0) && (
              <p className="text-sm text-red-400 mb-4">No payment method is active right now. Ask super admin to connect one.</p>
            )}
            {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
            <button
              onClick={continueToConfirm}
              disabled={!method}
              className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Continue with {methodMeta?.label ?? "method"}
            </button>
          </>
        )}
        {step === "confirm" && (
          <>
            <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-1">Almost there</p>
            <h3 className="fp-display text-xl mb-4">You&apos;ll be redirected to {methodMeta?.label ?? "your method"}</h3>
            <p className="fp-text-dim text-sm leading-relaxed mb-6">
              Complete your ${amount || "0"} payment on {methodMeta?.label ?? "the selected method"}&apos;s secure checkout.
              Your balance updates automatically — no card or wallet details ever touch our servers.
            </p>
            <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 flex items-center justify-between mb-6">
              <span className="fp-text-dim text-sm">Amount</span>
              <span className="fp-display text-lg fp-gold">${amount || "0"}</span>
            </div>
            {appliedRule && (
              <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 mb-6 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="fp-text-dim">Applied tier</span>
                  <span className="fp-safe">Top-up ≥ ${appliedRule.minAmount.toFixed(2)} · +{appliedRule.discountPct}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="fp-text-dim">Bonus</span>
                  <span className="fp-safe">+${bonusAmount.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="fp-text-dim">Total credited</span>
                  <span className="fp-gold">${creditedAmount.toFixed(2)}</span>
                </div>
              </div>
            )}
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button onClick={goToCheckout} disabled={busy} className="fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              {busy ? "Redirecting…" : `Go to ${methodMeta?.label ?? "checkout"}`}
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
  const cachedNav = readOwnerAppCache<{ section: string; activePanelId?: string | null; panelTab?: string }>("nav");
  const cachedPanels = readOwnerAppCache<Panel[]>("panels") ?? [];
  const [section, setSection] = useState(cachedNav?.section || initialSection || "home");
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const [panelInitialTab, setPanelInitialTab] = useState<string | undefined>(cachedNav?.panelTab);
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [ownerTopupPolicy, setOwnerTopupPolicy] = useState<OwnerTopupPolicy | null>(
    readOwnerAppCache<OwnerTopupPolicy>("owner-topup-policy")
  );
  const [ownerInnvilBalance, setOwnerInnvilBalance] = useState<number | null>(
    readOwnerAppCache<number>("owner-topup-balance")
  );
  const [panelList, setPanelList] = useState<Panel[]>(cachedPanels);
  const [loadingPanels, setLoadingPanels] = useState(cachedPanels.length === 0);
  const [syncingPanels, setSyncingPanels] = useState(cachedPanels.length > 0);
  const [isSuper, setIsSuper] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [focusOwnerCustomerId, setFocusOwnerCustomerId] = useState<string | null>(null);
  const didRestorePanelRef = useRef(false);

  useEffect(() => { amSuperAdmin().then(setIsSuper); }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([getOwnerTopupPolicy(), getOwnerBillingSummary()]).then(([nextPolicy, summary]) => {
      if (!alive) return;
      setOwnerTopupPolicy(nextPolicy);
      setOwnerInnvilBalance(summary.innvilBalance);
      writeOwnerAppCache("owner-topup-policy", nextPolicy);
      writeOwnerAppCache("owner-topup-balance", summary.innvilBalance);
    }).catch(() => {
      // ignore prefetch errors; modal can still fetch as fallback
    });
    return () => { alive = false; };
  }, []);

  const refreshPanels = useCallback(async () => {
    setLoadingPanels(panelList.length === 0);
    setSyncingPanels(panelList.length > 0);
    const next = await listPanels();
    setPanelList(next);
    writeOwnerAppCache("panels", next);
    setLoadingPanels(false);
    setSyncingPanels(false);
  }, []);

  useEffect(() => {
    refreshPanels();
  }, [refreshPanels]);

  useEffect(() => {
    if (didRestorePanelRef.current) return;
    const nav = readOwnerAppCache<{ section: string; activePanelId?: string | null; panelTab?: string }>("nav");
    if (!nav || nav.section !== "panelAdmin" || !nav.activePanelId) {
      didRestorePanelRef.current = true;
      return;
    }
    const found = panelList.find((p) => p.id === nav.activePanelId);
    if (!found) return;
    setActivePanel(found);
    setPanelInitialTab(nav.panelTab);
    setSection("panelAdmin");
    didRestorePanelRef.current = true;
  }, [panelList]);

  useEffect(() => {
    writeOwnerAppCache("nav", {
      section,
      activePanelId: section === "panelAdmin" ? (activePanel?.id ?? null) : null,
      panelTab: section === "panelAdmin" ? panelInitialTab : undefined,
    });
  }, [section, activePanel?.id, panelInitialTab]);

  const openPanel = (p: Panel, tab?: string) => { setActivePanel(p); setPanelInitialTab(tab); setSection("panelAdmin"); };
  const goCreate = () => setSection("create");
  const goPanels = () => setSection("panels");

  const handleCreate = async (input: { name: string; subdomain: string; theme: string; connectProvider: boolean }) => {
    const res = await createPanel({ name: input.name, subdomain: input.subdomain, theme: input.theme });
    if (!res.ok) return { ok: false, error: res.error };
    await refreshPanels();
    // Land the owner straight in the new panel — on Providers if they opted to set one up.
    openPanel(res.panel, input.connectProvider ? "providers" : undefined);
    return { ok: true };
  };

  const navSection = section === "panelAdmin" || section === "create" ? "panels" : section;

  return (
    <div className="fp-root min-h-screen flex">
      <AppSidebar section={navSection} setSection={setSection} isSuper={isSuper} />

      {/* Mobile nav drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <button aria-label="Close menu" onClick={() => setMobileNav(false)} className="absolute inset-0 bg-black/60" />
          <aside className="absolute left-0 top-0 bottom-0 w-64 max-w-[80vw] fp-void-2 border-r fp-line-soft p-5 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
                  <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
                </div>
                <span className="fp-display text-lg">Innvil</span>
              </div>
              <button onClick={() => setMobileNav(false)} className="fp-text-dim hover:fp-text p-1"><X size={18} /></button>
            </div>
            <nav className="space-y-1 flex-1">
              {navItemsFor(isSuper).map((it) => (
                <button
                  key={it.k}
                  onClick={() => { setSection(it.k); setMobileNav(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left ${navSection === it.k ? "fp-gold-soft-bg fp-gold" : "fp-text-dim hover:fp-text"}`}
                >
                  <it.icon size={16} /> {it.label}
                </button>
              ))}
            </nav>
            {isSuper && (
              <Link href="/superadmin" onClick={() => setMobileNav(false)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm fp-gold border-t fp-line-soft mt-2 pt-4">
                <ShieldCheck size={16} /> Super admin
              </Link>
            )}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <AppTopbar setWorld={setWorld} onOpenAccount={() => setSection("account")} onOpenNav={() => setMobileNav(true)} />
        {section === "account" && <AccountSettings />}
        {section === "home" && <DashboardHome panels={panelList} loading={loadingPanels} syncing={syncingPanels} goPanels={goPanels} goCreate={goCreate} goOrders={() => setSection("orders")} openPanel={openPanel} />}
        {section === "panels" && <MyPanels panels={panelList} loading={loadingPanels} syncing={syncingPanels} goCreate={goCreate} openPanel={openPanel} onChanged={refreshPanels} />}
        {section === "create" && <CreatePanelWizard onCreate={handleCreate} />}
        {section === "panelAdmin" && activePanel && (
          <PanelAdmin
            panel={activePanel}
            setWorld={setWorld}
            initialTab={panelInitialTab}
            onTabChange={setPanelInitialTab}
          />
        )}
        {section === "billing" && <OwnerBilling onAddFunds={() => setShowAddFunds(true)} />}
        {section === "earnings" && (
          <div className="p-4 sm:p-8 space-y-6 max-w-3xl">
            <div>
              <h1 className="fp-display text-2xl">Earnings &amp; receipts</h1>
              <p className="fp-text-dim text-sm mt-1">Your customers&apos; top-ups, total orders deduction, and your profit — pick any period and download a receipt.</p>
            </div>
            <ReceiptCard />
            <OwnerTopUps />
          </div>
        )}
        {section === "orders" && (
          <OwnerOrders
            onManageCustomer={(customerAccountId) => {
              setFocusOwnerCustomerId(customerAccountId);
              setSection("customers");
            }}
          />
        )}
        {section === "customers" && <OwnerCustomers focusCustomerId={focusOwnerCustomerId} />}
        {section === "provider-balances" && <OwnerProviderBalances />}
        {section === "support" && (
          <div className="p-4 sm:p-8">
            <Card title="Support inbox — all panels" icon={MessageSquare} right={<span className="text-xs fp-gold-soft-bg fp-gold px-2.5 py-1 rounded-full">Coming soon</span>}>
              <p className="fp-text-dim text-sm leading-relaxed">
                A unified ticket inbox across all your panels — view, reply, close, reopen, with optional
                auto-reply — is coming soon. Need help from Innvil?{" "}
                <button onClick={() => setSection("contact")} className="fp-gold">Contact support</button>.
              </p>
            </Card>
          </div>
        )}
        {section === "contact" && (isSuper ? <OwnerPanelSupport /> : <OwnerContactSupport />)}
      </div>
      {showAddFunds && (
        <AddFundsModal
          onClose={() => setShowAddFunds(false)}
          initialPolicy={ownerTopupPolicy}
          initialInnvilBalance={ownerInnvilBalance}
          panels={panelList}
        />
      )}
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

        <div className="p-4 sm:p-8 space-y-6">
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
