"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Sparkles, Menu, X, Wallet, Plus, Clock, Star, RotateCcw, Zap,
  LayoutGrid, ListOrdered, MessageSquare, KeyRound, UserCircle2,
  ShoppingCart, CheckCircle2, LogOut,
} from "lucide-react";
import {
  customerServices, customerOrders, customerWallet, customerTickets,
  initialFavoriteIds, recentServiceIds, CustomerService, CustomerOrder,
} from "@/src/data/constants";
import { PlatformGlyph } from "./PlatformIcons";
import { NewOrder, PlaceOrderHandler, PlatformMeta } from "./NewOrder";
import { ApiDocs } from "./ApiDocs";
import { CustomerTickets } from "./CustomerTickets";
import { formatMoney, currencySymbol } from "@/src/lib/money";

type Deposit = { amount: string; method: string; date: string; status: string };
type Ticket = { id: string; subj: string; status: string; updated: string };
export type PaymentMethod = { id: string; label: string; category: string; minTopup: number };

const PAY_CATEGORY_ORDER: { key: string; label: string }[] = [
  { key: "crypto", label: "Crypto" },
  { key: "card", label: "Card" },
  { key: "ewallet", label: "E-wallet" },
  { key: "bank", label: "Bank" },
];

/* =========================================================
   CUSTOMER DASHBOARD — fully independent from the
   Panel Owner dashboard. Nav: Dashboard, New Order, Orders,
   Wallet, Tickets, API, Profile. No Login/Register here.
   ========================================================= */

type CustomerPage = "dashboard" | "order" | "orders" | "wallet" | "tickets" | "api" | "profile";

const NAV: Array<{ k: CustomerPage; label: string; icon: typeof LayoutGrid }> = [
  { k: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { k: "order", label: "New Order", icon: ShoppingCart },
  { k: "orders", label: "Orders", icon: ListOrdered },
  { k: "wallet", label: "Wallet", icon: Wallet },
  { k: "tickets", label: "Tickets", icon: MessageSquare },
  { k: "api", label: "API", icon: KeyRound },
  { k: "profile", label: "Profile", icon: UserCircle2 },
];

const profileInputCls =
  "w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]";

const statusTone: Record<string, string> = {
  Completed: "fp-safe-soft-bg fp-safe",
  Processing: "fp-gold-soft-bg fp-gold",
  Pending: "fp-violet-soft-bg fp-violet",
  Partial: "fp-gold-soft-bg fp-gold",
  Canceled: "bg-red-500/10 text-red-400",
};

function ServiceQuickCard({
  service,
  onQuickOrder,
  badge,
  pathOverride,
  currency,
}: {
  service: CustomerService;
  onQuickOrder: (id: number) => void;
  badge?: React.ReactNode;
  pathOverride?: string | null;
  currency: string;
}) {
  return (
    <button
      onClick={() => onQuickOrder(service.id)}
      className="text-left rounded-xl border border-[#1E212A] bg-[#1B1E27] hover:border-[rgba(139,127,255,0.45)] transition-colors px-4 py-3 flex items-center gap-3 w-full"
    >
      <span className="w-9 h-9 rounded-lg fp-panel border fp-line-soft flex items-center justify-center fp-text-dim shrink-0">
        <PlatformGlyph platform={service.platform} size={15} pathOverride={pathOverride} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-sm font-medium truncate block">{service.name}</span>
        <span className="text-xs fp-text-faint fp-mono">
          {formatMoney(service.price, currency)}/{service.unit}
        </span>
      </span>
      {badge}
      <Zap size={14} className="fp-violet shrink-0" />
    </button>
  );
}

export function CustomerDashboard({
  canOrder,
  inactive,
  onLogout,
  brandName = "NovaBoost",
  logoUrl,
  services = customerServices,
  orders = customerOrders,
  walletBalance = customerWallet.balance,
  deposits = customerWallet.deposits,
  tickets = customerTickets,
  recentIds = recentServiceIds,
  email,
  onPlaceOrder,
  onAddFunds,
  onDeposit,
  platformMeta,
  currency = "USD",
  paymentMethods = [],
  panelId,
  apiEnabled = true,
  hasExistingApiKey = false,
  apiBaseUrl = "/api/v2",
  apiKey: initialApiKey = null,
  onRotateApiKey,
}: {
  canOrder: boolean;
  inactive: boolean;
  onLogout: () => void;
  /** Real data (all default to mock so the /?preview=1 switcher still works). */
  brandName?: string;
  logoUrl?: string;
  services?: CustomerService[];
  orders?: CustomerOrder[];
  walletBalance?: number;
  deposits?: Deposit[];
  tickets?: Ticket[];
  recentIds?: number[];
  email?: string;
  /** When set, New Order places real orders through this handler. */
  onPlaceOrder?: PlaceOrderHandler;
  onAddFunds?: () => void;
  /** Start a deposit via the given gateway → returns a checkout URL to redirect to. */
  onDeposit?: (amount: number, gateway?: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  platformMeta?: PlatformMeta;
  /** Panel operating currency (ISO code). */
  currency?: string;
  /** Connected payment methods (id/label/category) for the Add-Funds chooser. */
  paymentMethods?: PaymentMethod[];
  /** Real panel id — when set, the Tickets tab uses the live support system. */
  panelId?: string;
  /** Customer API status for this panel. */
  apiEnabled?: boolean;
  /** API base URL shown in docs. */
  apiBaseUrl?: string;
  /** Whether a key is already configured server-side (hidden by design). */
  hasExistingApiKey?: boolean;
  /** Current API key (revealed only on generation/rotation). */
  apiKey?: string | null;
  /** Rotate/generate the current customer's API key. */
  onRotateApiKey?: () => Promise<{ ok: boolean; key?: string; error?: string }>;
}) {
  const glyphPath = (key: string) => platformMeta?.[key]?.icon ?? undefined;
  const fmt = (n: number) => formatMoney(n, currency);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  // Add-Funds method chooser — group connected gateways by category.
  const payCategories = useMemo(
    () => PAY_CATEGORY_ORDER.filter((c) => paymentMethods.some((m) => m.category === c.key)),
    [paymentMethods]
  );
  const [payCat, setPayCat] = useState("");
  const activeCat = payCat || payCategories[0]?.key || "";
  const catMethods = useMemo(
    () => paymentMethods.filter((m) => m.category === activeCat),
    [paymentMethods, activeCat]
  );
  const [payGateway, setPayGateway] = useState("");
  const activeGateway = payGateway && catMethods.some((m) => m.id === payGateway) ? payGateway : "";
  const activeMethod = catMethods.find((m) => m.id === activeGateway) ?? null;
  const minTopup = activeMethod?.minTopup ?? 1;

  useEffect(() => {
    if (!payGateway && catMethods.length === 1) {
      setPayGateway(catMethods[0].id);
    }
    if (payGateway && !catMethods.some((m) => m.id === payGateway)) {
      setPayGateway("");
    }
  }, [catMethods, payGateway]);

  const startDeposit = async () => {
    if (!onDeposit || depositBusy) return;
    const amt = Number(depositAmount);
    if (!amt || amt <= 0) { setDepositError("Enter an amount."); return; }
    if (paymentMethods.length > 0 && !activeGateway) { setDepositError("Choose a payment method."); return; }
    if (amt < minTopup) { setDepositError(`Minimum top-up for ${activeMethod?.label ?? "this method"} is ${fmt(minTopup)}.`); return; }
    setDepositError(null);
    setDepositBusy(true); // shows the "Opening <method>…" overlay immediately (no silent gap)
    const res = await onDeposit(amt, activeGateway || undefined);
    if (!res.ok || !res.url) { setDepositBusy(false); setDepositError(res.error ?? "Could not start the deposit."); return; }
    setRedirecting(true); // keep the overlay up through navigation — no flash back to the form
    window.location.href = res.url; // hosted checkout
  };
  const [page, setPage] = useState<CustomerPage>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<number[]>(
    () => initialFavoriteIds.filter((id) => services.some((s) => s.id === id))
  );
  const [prefillServiceId, setPrefillServiceId] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(initialApiKey);
  const [keyRegenerated, setKeyRegenerated] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [savedCard, setSavedCard] = useState<string | null>(null);

  const regenerateApiKey = async () => {
    setApiError(null);
    if (!onRotateApiKey) {
      setApiError("API key rotation is unavailable right now.");
      return;
    }
    const res = await onRotateApiKey();
    if (!res.ok || !res.key) {
      setApiError(res.error ?? "Could not generate API key.");
      return;
    }
    setApiKey(res.key);
    setKeyRegenerated(true);
  };

  const toggleFavorite = (id: number) =>
    setFavoriteIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  // One click from anywhere to a pre-filled order form
  const quickOrder = (serviceId: number) => {
    setPrefillServiceId(serviceId);
    setPage("order");
    setMenuOpen(false);
  };

  const favoriteServices = useMemo(
    () => services.filter((s) => favoriteIds.includes(s.id)),
    [favoriteIds, services]
  );
  const recentServices = useMemo(
    () =>
      recentIds
        .map((id) => services.find((s) => s.id === id))
        .filter((s): s is CustomerService => Boolean(s))
        .slice(0, 4),
    [recentIds, services]
  );

  const pendingCount = orders.filter(
    (o) => o.status === "Processing" || o.status === "Pending"
  ).length;
  const completedToday = orders.filter(
    (o) => o.status === "Completed" && o.date.startsWith("Today")
  ).length;

  const go = (p: CustomerPage) => {
    if (p === "order") setPrefillServiceId(null);
    setPage(p);
    setMenuOpen(false);
  };

  return (
    <div className="fp-root min-h-screen fp-grid-bg">
      {inactive && (
        <div className="fp-gold-soft-bg border-b border-[rgba(201,165,116,0.2)] px-4 py-2.5 text-center">
          <p className="fp-gold text-sm flex items-center justify-center gap-2">
            <Clock size={13} />
            New orders are temporarily paused. You can still browse, add funds, and view history.
          </p>
        </div>
      )}

      {/* Header — wallet balance + Add Funds always visible */}
      <header className="border-b fp-line-soft bg-[#0A0B0F]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden w-9 h-9 rounded-lg fp-panel-raised border fp-line-soft flex items-center justify-center fp-text-dim"
              aria-label="Menu"
            >
              {menuOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={brandName} className="w-7 h-7 rounded-md object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-md fp-violet-bg flex items-center justify-center">
                <Sparkles size={14} color="#0A0B0F" />
              </div>
            )}
            <span className="fp-display text-lg hidden sm:inline">{brandName}</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((n) => (
              <button
                key={n.k}
                onClick={() => go(n.k)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                  page === n.k ? "fp-violet-soft-bg fp-violet" : "fp-text-dim hover:fp-text"
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <span className="fp-mono text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
              <span className="fp-text-faint hidden sm:inline">Balance </span>
              <span className="fp-gold">{fmt(walletBalance)}</span>
            </span>
            <button
              onClick={() => (onAddFunds ? onAddFunds() : go("wallet"))}
              className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1"
            >
              <Plus size={13} /> <span className="hidden sm:inline">Add Funds</span>
            </button>
          </div>
        </div>

        {/* Mobile hamburger menu */}
        {menuOpen && (
          <nav className="md:hidden border-t fp-line-soft bg-[#0D0F14] px-4 py-3 space-y-1">
            {NAV.map((n) => (
              <button
                key={n.k}
                onClick={() => go(n.k)}
                className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg text-sm ${
                  page === n.k ? "fp-violet-soft-bg fp-violet" : "fp-text-dim"
                }`}
              >
                <n.icon size={16} /> {n.label}
              </button>
            ))}
            <button
              onClick={onLogout}
              className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg text-sm fp-text-faint"
            >
              <LogOut size={16} /> Log out
            </button>
          </nav>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* ---------- DASHBOARD ---------- */}
        {page === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Wallet balance", value: fmt(walletBalance), tone: "fp-gold" },
                { label: "Pending orders", value: String(pendingCount), tone: "fp-violet" },
                { label: "Completed today", value: String(completedToday), tone: "fp-safe" },
                { label: "Total orders", value: String(orders.length), tone: "" },
              ].map((s) => (
                <div key={s.label} className="fp-panel border fp-line rounded-2xl p-4">
                  <p className="fp-text-faint text-[11px] fp-mono uppercase tracking-wide">{s.label}</p>
                  <p className={`fp-display text-2xl mt-1.5 ${s.tone}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Quick order — favorites */}
              <div className="fp-panel border fp-line rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="fp-display text-lg flex items-center gap-2">
                    <Star size={15} className="fp-gold" /> Favorites
                  </p>
                  <span className="fp-text-faint text-xs fp-mono">1-click quick order</span>
                </div>
                {favoriteServices.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm fp-text-dim mb-3">No favorites yet.</p>
                    <button
                      onClick={() => go("order")}
                      className="text-sm fp-violet"
                    >
                      Star a service while ordering to pin it here →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {favoriteServices.map((s) => (
                      <ServiceQuickCard key={s.id} service={s} onQuickOrder={quickOrder} pathOverride={glyphPath(s.platform)} currency={currency} />
                    ))}
                  </div>
                )}
              </div>

              {/* Recently ordered */}
              <div className="fp-panel border fp-line rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="fp-display text-lg flex items-center gap-2">
                    <Clock size={15} className="fp-violet" /> Recently ordered
                  </p>
                </div>
                <div className="space-y-2">
                  {recentServices.map((s) => (
                    <ServiceQuickCard key={s.id} service={s} onQuickOrder={quickOrder} pathOverride={glyphPath(s.platform)} currency={currency} />
                  ))}
                </div>
              </div>
            </div>

            {/* Recent orders */}
            <div className="fp-panel border fp-line rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="fp-display text-lg">Recent orders</p>
                <button onClick={() => go("orders")} className="text-xs fp-violet">
                  View all →
                </button>
              </div>
              <OrderRows orders={orders.slice(0, 3)} services={services} onReorder={quickOrder} compact platformMeta={platformMeta} />
            </div>
          </div>
        )}

        {/* ---------- NEW ORDER ---------- */}
        {page === "order" && (
          <NewOrder
            canOrder={canOrder}
            favoriteIds={favoriteIds}
            onToggleFavorite={toggleFavorite}
            prefillServiceId={prefillServiceId}
            services={services}
            onPlaceOrder={onPlaceOrder}
            platformMeta={platformMeta}
            currency={currency}
          />
        )}

        {/* ---------- ORDERS ---------- */}
        {page === "orders" && (
          <div className="fp-panel border fp-line rounded-2xl p-5">
            <p className="fp-display text-lg mb-4">Order history</p>
            {orders.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm fp-text-dim mb-3">You haven&apos;t placed any orders yet.</p>
                <button onClick={() => go("order")} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg">
                  Place your first order
                </button>
              </div>
            ) : (
              <OrderRows orders={orders} services={services} onReorder={quickOrder} />
            )}
          </div>
        )}

        {/* ---------- WALLET ---------- */}
        {page === "wallet" && (
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <div className="fp-panel border fp-gold-border rounded-2xl p-6">
              <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide">Wallet balance</p>
              <p className="fp-display text-4xl fp-gold mt-2 mb-6">
                {fmt(walletBalance)}
              </p>
              <p className="text-sm fp-text-dim mb-4">
                {inactive
                  ? "Deposits stay available in Inactive Mode — orders resume automatically once the panel is back."
                  : "Top up once, order across every platform."}
              </p>
              {!onDeposit ? (
                <p className="fp-text-faint text-sm">Funding isn&apos;t available on this panel yet.</p>
              ) : paymentMethods.length === 0 ? (
                <p className="fp-text-faint text-sm">This panel hasn&apos;t enabled a payment method yet.</p>
              ) : (
                <div className="space-y-3">
                  <label className="fp-text-faint text-xs fp-mono uppercase tracking-wide">Add funds</label>

                  {/* Payment category */}
                  {payCategories.length > 1 && (
                    <div className="flex gap-2 flex-wrap">
                      {payCategories.map((c) => (
                        <button
                          key={c.key}
                          onClick={() => { setPayCat(c.key); setPayGateway(""); }}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                            activeCat === c.key ? "fp-gold-soft-bg fp-gold fp-gold-border" : "fp-panel-raised fp-text-dim border-[#262A35] hover:fp-text"
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Method within the category — dropdown when there's more than one */}
                  {catMethods.length > 1 && (
                    <select
                      value={activeGateway}
                      onChange={(e) => setPayGateway(e.target.value)}
                      className="w-full bg-[#1B1E27] border border-[#1E212A] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[rgba(201,165,116,0.35)] text-[#EDEAE2]"
                    >
                      {catMethods.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  )}
                  {catMethods.length === 1 && activeMethod && (
                    <div className="w-full bg-[#1B1E27] border border-[#1E212A] rounded-xl px-3 py-2.5 text-sm text-[#EDEAE2]">
                      {activeMethod.label}
                    </div>
                  )}

                  {activeMethod && (
                    <p className="fp-text-faint text-xs">
                      Method: <span className="fp-text">{activeMethod.label}</span> · Minimum: <span className="fp-gold">{fmt(minTopup)}</span>
                    </p>
                  )}

                  {/* Amount */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 fp-text-faint text-sm">{currencySymbol(currency)}</span>
                      <input
                        value={depositAmount}
                        onChange={(e) => { setDepositAmount(e.target.value); setDepositError(null); }}
                        onKeyDown={(e) => e.key === "Enter" && startDeposit()}
                        type="number" inputMode="decimal" min={String(minTopup)} step="0.01" placeholder="25.00"
                        className="w-full bg-[#1B1E27] border border-[#1E212A] rounded-xl pl-8 pr-3 py-3 text-sm fp-mono outline-none focus:border-[rgba(201,165,116,0.35)] text-[#EDEAE2]"
                      />
                    </div>
                    <button onClick={startDeposit} disabled={depositBusy} className="fp-btn-primary text-sm font-semibold px-5 rounded-xl disabled:opacity-70 whitespace-nowrap flex items-center gap-1.5">
                      {depositBusy && <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                      {redirecting ? "Redirecting…" : depositBusy ? "Opening…" : "Add funds"}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {[10, 25, 50, 100].map((v) => (
                      <button key={v} disabled={depositBusy} onClick={() => setDepositAmount(String(v))} className="text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 fp-text-dim hover:fp-gold-border disabled:opacity-50">{fmt(v)}</button>
                    ))}
                  </div>
                  {depositBusy ? (
                    <p className="fp-gold text-xs flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      {redirecting
                        ? `Redirecting you to ${activeMethod?.label ?? "the secure checkout"}…`
                        : `Opening ${activeMethod?.label ?? "the secure checkout"} for your ${fmt(Number(depositAmount) || 0)} top-up…`}
                    </p>
                  ) : depositError ? (
                    <p className="text-xs text-red-400">{depositError}</p>
                  ) : (
                    <p className="fp-text-faint text-[11px]">You&apos;ll be sent to a secure checkout. Your balance updates automatically once the payment confirms.</p>
                  )}
                </div>
              )}
            </div>
            <div className="fp-panel border fp-line rounded-2xl p-6">
              <p className="fp-display text-lg mb-4">Deposit history</p>
              {deposits.length === 0 && (
                <p className="fp-text-faint text-sm py-6 text-center">No deposits yet.</p>
              )}
              {deposits.map((d) => (
                <div key={d.date + d.amount} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3 text-sm">
                  <div>
                    <p className="fp-safe fp-mono">{d.amount}</p>
                    <p className="text-xs fp-text-faint mt-0.5">{d.method}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs fp-text-dim">{d.date}</p>
                    <p className="text-xs fp-safe mt-0.5 flex items-center gap-1 justify-end">
                      <CheckCircle2 size={11} /> {d.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- TICKETS ---------- */}
        {page === "tickets" && (
          panelId ? (
            <CustomerTickets panelId={panelId} />
          ) : (
            <div className="fp-panel border fp-line rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="fp-display text-lg">Support tickets</p>
                <button className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1">
                  <Plus size={13} /> New ticket
                </button>
              </div>
              {tickets.length === 0 && (
                <p className="fp-text-faint text-sm py-6 text-center">No tickets yet.</p>
              )}
              {tickets.map((t) => (
                <div key={t.id} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3.5 text-sm gap-3">
                  <div className="min-w-0">
                    <p className="truncate">{t.subj}</p>
                    <p className="text-xs fp-text-faint fp-mono mt-0.5">{t.id} · {t.updated}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${t.status === "Answered" ? "fp-safe-soft-bg fp-safe" : "fp-panel-raised fp-text-dim"}`}>
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          )
        )}

        {/* ---------- API ---------- */}
        {page === "api" && (
          <div className="max-w-3xl">
            <ApiDocs
              apiBaseUrl={apiBaseUrl}
              apiKey={apiKey}
              inactive={inactive}
              enabled={apiEnabled}
              hasExistingApiKey={hasExistingApiKey}
              onRegenerate={regenerateApiKey}
              keyRegenerated={keyRegenerated}
            />
            {apiError && <p className="text-xs text-red-400 mt-3">{apiError}</p>}
          </div>
        )}

        {/* ---------- PROFILE ---------- */}
        {page === "profile" && (
          <div className="max-w-2xl space-y-5">
            {/* Username */}
            <div className="fp-panel border fp-line rounded-2xl p-6">
              <p className="fp-display text-lg mb-5">Username</p>
              <input
                defaultValue={email ? email.split("@")[0] : "marisol.co"}
                className={profileInputCls}
              />
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setSavedCard("username")}
                  className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg"
                >
                  Save username
                </button>
                {savedCard === "username" && (
                  <span className="text-xs fp-safe flex items-center gap-1">
                    <CheckCircle2 size={12} /> Saved
                  </span>
                )}
              </div>
            </div>

            {/* Email */}
            <div className="fp-panel border fp-line rounded-2xl p-6">
              <p className="fp-display text-lg mb-1">Email</p>
              <p className="text-xs fp-text-dim mb-5">
                We&apos;ll send a confirmation link to the new address before it takes effect.
              </p>
              <div className="space-y-3">
                <input defaultValue={email ?? "marisol@example.com"} type="email" className={profileInputCls} />
                <input placeholder="Current password" type="password" className={profileInputCls} />
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setSavedCard("email")}
                  className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg"
                >
                  Change email
                </button>
                {savedCard === "email" && (
                  <span className="text-xs fp-safe flex items-center gap-1">
                    <CheckCircle2 size={12} /> Confirmation sent
                  </span>
                )}
              </div>
            </div>

            {/* Password */}
            <div className="fp-panel border fp-line rounded-2xl p-6">
              <p className="fp-display text-lg mb-5">Change password</p>
              <div className="space-y-3">
                <input placeholder="Current password" type="password" className={profileInputCls} />
                <input placeholder="New password" type="password" className={profileInputCls} />
                <input placeholder="Confirm new password" type="password" className={profileInputCls} />
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setSavedCard("password")}
                  className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg"
                >
                  Update password
                </button>
                {savedCard === "password" && (
                  <span className="text-xs fp-safe flex items-center gap-1">
                    <CheckCircle2 size={12} /> Password updated
                  </span>
                )}
              </div>
            </div>

            {/* Log out */}
            <div className="fp-panel border fp-line rounded-2xl p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Log out</p>
                <p className="text-xs fp-text-dim mt-0.5">End your session on this device.</p>
              </div>
              <button
                onClick={onLogout}
                className="text-sm fp-text-dim border fp-line rounded-lg px-4 py-2 hover:fp-text flex items-center gap-2"
              >
                <LogOut size={14} /> Log out
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function OrderRows({
  orders,
  services,
  onReorder,
  compact = false,
  platformMeta,
}: {
  orders: CustomerOrder[];
  services: CustomerService[];
  onReorder: (serviceId: number) => void;
  compact?: boolean;
  platformMeta?: PlatformMeta;
}) {
  return (
    <div>
      {orders.map((o) => {
        const svc = services.find((s) => s.id === o.serviceId);
        return (
          <div
            key={o.id}
            className="flex items-center gap-3 border-b fp-line-soft last:border-0 py-3.5"
          >
            {svc && (
              <span className="w-8 h-8 rounded-lg fp-panel-raised border fp-line-soft flex items-center justify-center fp-text-dim shrink-0">
                <PlatformGlyph platform={svc.platform} size={13} pathOverride={platformMeta?.[svc.platform]?.icon ?? undefined} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">{o.service}</p>
              <p className="text-xs fp-text-faint fp-mono mt-0.5 truncate">
                #{o.id} · {o.qty.toLocaleString()} · {o.date}
                {!compact && ` · ${o.link}`}
              </p>
            </div>
            <span className="fp-mono text-sm shrink-0">{o.amount}</span>
            <span className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${statusTone[o.status]}`}>
              {o.status}
            </span>
            {o.status === "Completed" && (
              <button
                onClick={() => onReorder(o.serviceId)}
                className="shrink-0 text-xs fp-violet border border-[rgba(139,127,255,0.35)] rounded-lg px-2.5 py-1.5 hover:fp-violet-soft-bg flex items-center gap-1 transition-colors"
                title="Reorder"
              >
                <RotateCcw size={11} /> <span className="hidden sm:inline">Reorder</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
