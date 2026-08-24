"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid, FolderKanban, Users, Bot, Activity, Network,
  CreditCard, Layers, Settings, LogOut, Menu, X, Plus, User, HelpCircle, ShieldCheck,
} from "lucide-react";
import { signOutAction } from "@/src/lib/actions/auth";
import { withTimeout } from "@/src/lib/timeout";
import type { AccountCapacity } from "@/src/lib/products/watch-runtime";
import { watchAccessLabel } from "@/src/lib/products/watch-plans";
import { getInnvilCreditBalanceAction } from "@/src/lib/actions/innvil-credit";
import { amSuperAdmin } from "@/src/lib/actions/superadmin";
import { HeaderCreditIndicator } from "./HeaderCreditIndicator";

const LOGOUT_TIMEOUT_MS = 8000;

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutGrid;
  href: string;
  implemented: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { id: "projects", label: "Projects", icon: FolderKanban, href: "/projects", implemented: true },
  { id: "communities", label: "Communities", icon: Users, href: "/communities", implemented: true },
  { id: "watchers", label: "Watchers", icon: Bot, href: "/watchers", implemented: true },
];

// Knowledge is real, but it's PROJECT-scoped (a tab inside each Project's own
// detail page, see app/projects/[id]/page.tsx), never a single global
// destination -- there's nothing meaningful for a top-level "Knowledge" link
// to point at. Auto-Posting is real for standalone accounts too now (Phase
// 4.N.1, watch-autopost.ts) but is Community-scoped, not a global
// destination either -- it lives as a tab on each Community's detail page
// (app/communities/[id]/page.tsx), same as Presence.
//
// Deployments (app/deployments/page.tsx) is the real operational surface for
// "what is deployed, where, and why it's consuming Watcher slots" -- a
// Deployment (Watcher <-> Community relationship) is its own CRM-style
// record, not just a Billing/Usage side-effect, so it gets its own
// Operations destination instead of being buried inside Usage.
const OPERATIONS_NAV: NavItem[] = [
  { id: "activity", label: "Activity", icon: Activity, href: "/activity", implemented: true },
  { id: "deployments", label: "Deployments", icon: Network, href: "/deployments", implemented: true },
];

// Profile = who the account is (Innvil identity + connected Telegram
// identity, app/profile/page.tsx). Distinct from Settings (how Watch
// behaves) and from the operational Workspace resources above -- it belongs
// in this same Account group, not a new top-level destination, since that
// already matches how Usage/Billing/Settings are presented.
const ACCOUNT_NAV: NavItem[] = [
  { id: "profile", label: "Profile", icon: User, href: "/profile", implemented: true },
  { id: "usage", label: "Usage", icon: LayoutGrid, href: "/usage", implemented: true },
  { id: "plans", label: "Plans", icon: Layers, href: "/plans", implemented: true },
  { id: "billing", label: "Billing", icon: CreditCard, href: "/billing", implemented: true },
  { id: "settings", label: "Settings", icon: Settings, href: "/settings", implemented: true },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  if (!item.implemented) {
    return (
      <span
        aria-disabled="true"
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-text-faint opacity-50 cursor-not-allowed"
        title="Coming soon"
      >
        <Icon size={16} /> {item.label}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
        active ? "w-teal-soft-bg w-teal font-medium" : "w-text-dim hover:w-text hover:w-surface-raised"
      }`}
    >
      <Icon size={16} /> {item.label}
    </Link>
  );
}

function SidebarContent({ active, capacity, isSuper, onNavigate }: { active: string; capacity: AccountCapacity | null; isSuper: boolean; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col h-full" onClick={onNavigate}>
      <Link href="/" className="flex items-center gap-2.5 px-4 py-4 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/watch/app-tile.svg" alt="" width={32} height={32} className="w-8 h-8 rounded-[8px]" />
        <div className="leading-tight">
          <span className="w-display text-sm block">Innvil Watch</span>
          <span className="text-[10px] w-text-faint">Part of Innvil</span>
        </div>
      </Link>

      <nav aria-label="Watch navigation" className="flex-1 overflow-y-auto px-2.5 py-2 space-y-5">
        <div>
          <NavLink item={{ id: "overview", label: "Overview", icon: LayoutGrid, href: "/", implemented: true }} active={active === "overview"} />
        </div>
        <div>
          <p className="px-3 text-[10px] uppercase tracking-wider w-text-faint font-semibold mb-1.5">Workspace</p>
          <div className="space-y-0.5">
            {WORKSPACE_NAV.map((item) => <NavLink key={item.id} item={item} active={active === item.id} />)}
          </div>
        </div>
        <div>
          <p className="px-3 text-[10px] uppercase tracking-wider w-text-faint font-semibold mb-1.5">Operations</p>
          <div className="space-y-0.5">
            {OPERATIONS_NAV.map((item) => <NavLink key={item.id} item={item} active={active === item.id} />)}
          </div>
        </div>
        <div>
          <p className="px-3 text-[10px] uppercase tracking-wider w-text-faint font-semibold mb-1.5">Account</p>
          <div className="space-y-0.5">
            {ACCOUNT_NAV.map((item) => <NavLink key={item.id} item={item} active={active === item.id} />)}
          </div>
        </div>
        {isSuper && (
          <div>
            <p className="px-3 text-[10px] uppercase tracking-wider w-text-faint font-semibold mb-1.5">Innvil</p>
            <div className="space-y-0.5">
              <NavLink item={{ id: "superadmin", label: "Super admin", icon: ShieldCheck, href: "/superadmin", implemented: true }} active={active === "superadmin"} />
            </div>
          </div>
        )}
      </nav>

      {capacity && (
        <Link href="/plans" className="block px-4 py-3 mx-2.5 mb-2 rounded-lg w-surface-raised border w-line-soft shrink-0 hover:w-teal-border">
          <p className="text-[10px] uppercase tracking-wide w-text-faint mb-1">{capacity.tier === "trial" ? "Access" : "Plan"}</p>
          <p className="w-display text-sm w-teal">{watchAccessLabel(capacity.tier, { apiSourceMode: capacity.apiSourceMode ?? "managed", slots: capacity.enterpriseSlots })}</p>
          <p className="text-[11px] w-text-faint mt-0.5">
            {capacity.activeDeploymentCount}/{capacity.slotsTotal} slots · {capacity.communitiesUsed}/{capacity.communitiesTotal} Communities
          </p>
        </Link>
      )}

      <Link
        href="/support"
        aria-current={active === "support" ? "page" : undefined}
        className={`flex items-center gap-2 px-4 py-3 mx-2.5 mb-2 text-xs shrink-0 ${active === "support" ? "w-teal font-medium" : "w-text-faint hover:w-text-dim"}`}
      >
        <HelpCircle size={14} /> Need help?
      </Link>
    </div>
  );
}

/** Persistent authenticated Watch shell: sidebar (desktop) / drawer (mobile)
 *  + top bar + content area. Every Workspace/Operations/Account nav item is a
 *  real dedicated route with its own data (see app/projects, app/communities,
 *  app/watchers, app/activity, app/usage, app/billing, app/settings).
 *  Knowledge is real too, but Project-scoped (a tab inside each Project's own
 *  detail page) rather than a global destination. Auto-Posting is real for
 *  standalone accounts too (Phase 4.N.1) but is Community-scoped -- a tab on
 *  each Community's detail page, same as Presence -- so it's also omitted
 *  from this sidebar, not because it's unbuilt. */
export function WatchShell({
  active, capacity, primaryAction, attentionCount = 0, children,
}: {
  active: string;
  capacity: AccountCapacity | null;
  primaryAction?: { label: string; onClick: () => void };
  attentionCount?: number;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  // Account-wide Innvil Credit balance -- fetched once per page load via the
  // SAME canonical getInnvilCreditBalance() Billing's own Innvil Credit
  // section reads (never a second/duplicated balance calculation). A full
  // page navigation/reload (this codebase's existing data-refresh model --
  // capacity/attentionCount are resolved the same server-per-request way,
  // never live-pushed) is what refreshes it after a top-up/purchase/renewal.
  const [creditBalanceCents, setCreditBalanceCents] = useState<number | null>(null);
  // Whether the signed-in account holds the super_admin role -- Watch has its
  // own session per host (see CLAUDE.md's product-brand/auth notes), so this
  // is resolved independently here rather than assumed from any main-app
  // state. Reuses the EXACT SAME server action (amSuperAdmin) the main
  // owner-app sidebar/`/superadmin` route already gate on -- never a second
  // role check. Fails safe (stays false) on any error -- an unresolved check
  // must never accidentally reveal the link.
  const [isSuper, setIsSuper] = useState(false);

  useEffect(() => {
    let cancelled = false;
    amSuperAdmin()
      .then((v) => { if (!cancelled) setIsSuper(v); })
      .catch(() => { if (!cancelled) setIsSuper(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    let cancelled = false;
    getInnvilCreditBalanceAction()
      .then((b) => { if (!cancelled) setCreditBalanceCents(b.balanceCents); })
      .catch(() => { if (!cancelled) setCreditBalanceCents(0); });
    return () => { cancelled = true; };
  }, []);

  const logOut = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await withTimeout(signOutAction(), LOGOUT_TIMEOUT_MS, "Sign out");
    } catch (err) {
      console.error("[watch] sign out failed", err);
      setLogoutError("Sign out failed or timed out. Try again, or reload the page.");
      setLoggingOut(false);
      return;
    }
    window.location.href = "/";
  };

  return (
    <div id="top" className="watch-root min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 border-r w-line-soft">
        <div className="sticky top-0 h-screen">
          <SidebarContent active={active} capacity={capacity} isSuper={isSuper} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Watch navigation" className="relative w-64 h-full w-surface border-r w-line-soft">
            <button
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="absolute top-4 right-3 w-text-dim hover:w-text"
            >
              <X size={18} />
            </button>
            <SidebarContent active={active} capacity={capacity} isSuper={isSuper} onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-[#0A0E11]/90 border-b w-line-soft">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                className="lg:hidden w-text-dim hover:w-text shrink-0"
              >
                <Menu size={20} />
              </button>
              <h1 className="w-display text-sm sm:text-base capitalize truncate">{active === "overview" ? "Overview" : active}</h1>
              {attentionCount > 0 && (
                <Link href="/" className="w-pill w-amber-soft-bg w-amber text-[11px] shrink-0 hidden sm:inline-flex">
                  {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {primaryAction && (
                <button onClick={primaryAction.onClick} className="w-btn-primary text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 rounded-lg flex items-center gap-1.5">
                  <Plus size={14} /> <span className="hidden sm:inline">{primaryAction.label}</span>
                </button>
              )}
              {creditBalanceCents != null && <HeaderCreditIndicator balanceCents={creditBalanceCents} />}
              <div className="flex flex-col items-end">
                <button
                  onClick={logOut}
                  disabled={loggingOut}
                  aria-label="Log out"
                  className="text-xs w-text-dim hover:w-text flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border w-line-soft disabled:opacity-60"
                >
                  <LogOut size={13} /> <span className="hidden sm:inline">{loggingOut ? "Signing out…" : "Log out"}</span>
                </button>
                {logoutError && <p className="text-[10px] text-red-400 max-w-[180px] text-right mt-1">{logoutError}</p>}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
