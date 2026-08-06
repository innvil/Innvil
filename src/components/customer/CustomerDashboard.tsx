"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Menu, X, Wallet, Plus, Clock, Star, RotateCcw, Zap,
  LayoutGrid, ListOrdered, MessageSquare, KeyRound, UserCircle2,
  ShoppingCart, CheckCircle2, LogOut, FileText, AlertTriangle, ClipboardList,
} from "lucide-react";
import {
  customerServices, customerOrders, customerWallet, customerTickets,
  initialFavoriteIds, recentServiceIds, CustomerService, CustomerOrder,
} from "@/src/data/constants";
import { PlatformGlyph } from "./PlatformIcons";
import { DefaultLogo } from "@/src/components/ui/BrandMark";
import { NewOrder, PlaceOrderHandler, PlatformMeta } from "./NewOrder";
import { ApiDocs } from "./ApiDocs";
import { CustomerTickets } from "./CustomerTickets";
import { SupportChat } from "./SupportChat";
import { CampaignSurface } from "./CampaignSurface";
import { MassOrder } from "./MassOrder";
import { formatMoney, currencySymbol } from "@/src/lib/money";
import type { DashboardWidget } from "@/src/lib/dashboard-layout";
import { getBinanceDepositBreakdown } from "@/src/lib/payments/binance-amounts";

type Deposit = { amount: string; method: string; date: string; status: string };
type Ticket = { id: string; subj: string; status: string; updated: string };
type TopupDiscountRule = { minAmount: number; discountPct: number };
export type PaymentMethod = {
  id: string;
  label: string;
  category: string;
  minTopup: number;
  discountPct: number | null;
  discountRules: TopupDiscountRule[];
  /** true = verified by Binance Order ID (Binance Pay), not a hosted redirect. */
  manual?: boolean;
};

export type BinanceDepositInfo = {
  paymentId: string;
  payId: string;
  qrImage: string | null;
  amount: number;
  payable: number;
  asset: string;
  expiresAt: string;
  instructions: string[];
};
export type BinanceClaimResult =
  | { ok: true; code: "PAYMENT_CONFIRMED"; message: string; credited: number; received: number }
  | { ok: false; code: string; message: string; pending?: boolean };

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function pickDiscountRule(amount: number, rules: TopupDiscountRule[]): TopupDiscountRule | null {
  if (!Number.isFinite(amount) || amount <= 0 || rules.length === 0) return null;
  let picked: TopupDiscountRule | null = null;
  for (const r of rules) {
    if (amount >= r.minAmount) picked = r;
    else break;
  }
  return picked;
}

const PAY_CATEGORY_ORDER: { key: string; label: string }[] = [
  { key: "crypto", label: "Crypto" },
  { key: "card", label: "Card" },
  { key: "ewallet", label: "E-wallet" },
  { key: "bank", label: "Bank" },
];

/** Binance Pay — a 2-step flow: (1) Make payment, (2) Verify by Binance Order ID.
 *  The customer pays the exact amount, then pastes their Binance Order ID, which
 *  the server verifies. */
function BinancePayPanel({
  info, onClaim, onDone,
}: {
  info: BinanceDepositInfo;
  onClaim?: (paymentId: string, orderId: string) => Promise<BinanceClaimResult>;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"pay" | "verify">("pay");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" | "pending" } | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState<"pay" | "amt" | null>(null);
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(info.expiresAt).getTime() - Date.now()));

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => setRemaining(Math.max(0, new Date(info.expiresAt).getTime() - Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [info.expiresAt, done]);

  const expired = remaining <= 0 && !done;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const breakdown = useMemo(() => {
    try {
      return getBinanceDepositBreakdown(info.amount, info.payable, 4);
    } catch {
      // Fallback should never happen for valid server payloads.
      return {
        base: String(info.amount),
        increment: "0",
        totalToSend: String(info.payable),
        walletCredit: String(info.payable),
      };
    }
  }, [info.amount, info.payable]);

  const copy = async (text: string, which: "pay" | "amt") => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  };

  const verify = async () => {
    if (!onClaim || busy) return;
    const id = orderId.trim();
    if (!id) { setMsg({ text: "Paste your Binance Order ID.", tone: "error" }); return; }
    setBusy(true); setMsg(null);
    const res = await onClaim(info.paymentId, id);
    setBusy(false);
    if (res.ok || res.code === "PAYMENT_ALREADY_CREDITED") { setMsg({ text: res.message, tone: "ok" }); setDone(true); return; }
    setMsg({ text: res.message, tone: res.code === "ORDER_PENDING_BINANCE_HISTORY" ? "pending" : "error" });
  };

  const Stepper = (
    <div className="flex items-center justify-center gap-3 text-xs">
      <span className={`flex items-center gap-1.5 ${step === "pay" ? "fp-gold" : "fp-safe"}`}>
        <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] ${step === "pay" ? "fp-gold-soft-bg fp-gold-border border" : "fp-safe-soft-bg"}`}>{step === "verify" ? <CheckCircle2 size={12} /> : "1"}</span>
        Make payment
      </span>
      <span className="w-8 h-px fp-line" />
      <span className={`flex items-center gap-1.5 ${step === "verify" ? "fp-gold" : "fp-text-faint"}`}>
        <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] border ${step === "verify" ? "fp-gold-soft-bg fp-gold-border" : "fp-line-soft"}`}>2</span>
        Verify payment
      </span>
    </div>
  );

  return (
    <div className="fp-panel-raised border fp-gold-border rounded-xl p-4 space-y-3">
      {Stepper}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Binance Pay</p>
        {!done && (
          <span className={`text-xs flex items-center gap-1 ${expired ? "text-red-400" : "fp-text-dim"}`}>
            <Clock size={12} /> {expired ? "Expired" : `${mm}:${String(ss).padStart(2, "0")}`}
          </span>
        )}
      </div>

      <div className="text-center">
        <span className="fp-display text-2xl fp-gold">{breakdown.totalToSend}</span> <span className="fp-text-dim text-sm">{info.asset}</span>
      </div>

      <div className="fp-panel-raised border fp-line-soft rounded-lg p-3 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="fp-text-faint">Base deposit amount</span>
          <span className="fp-mono fp-text">{breakdown.base} {info.asset}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="fp-text-faint">Unique verification increment</span>
          <span className="fp-mono fp-gold">+{breakdown.increment} {info.asset}</span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t fp-line-soft pt-2">
          <span className="fp-text-faint">Total amount to send</span>
          <span className="fp-mono fp-text">{breakdown.totalToSend} {info.asset}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="fp-text-faint">Exact wallet amount credited</span>
          <span className="fp-mono fp-safe">{breakdown.walletCredit} {info.asset}</span>
        </div>
      </div>
      <p className="text-[11px] fp-text-dim leading-relaxed">
        The small decimal increment helps us uniquely identify your payment. The full amount you send will be credited to your wallet.
      </p>

      <div className="flex items-center justify-between gap-2 bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2">
        <div className="min-w-0">
          <p className="fp-text-faint text-[10px] fp-mono uppercase">Send to Binance ID</p>
          <p className="fp-mono text-sm truncate">{info.payId}</p>
        </div>
        <button onClick={() => copy(info.payId, "pay")} className="text-xs fp-gold border fp-line-soft rounded-lg px-2.5 py-1.5 shrink-0">{copied === "pay" ? "Copied" : "Copy"}</button>
      </div>

      {step === "pay" && !done && (
        <>
          {info.qrImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.qrImage} alt="Binance Pay QR" className="w-40 h-40 rounded-lg object-contain mx-auto bg-white p-2" />
          )}
          <p className="text-[11px] text-amber-400/90 flex items-center gap-1.5"><AlertTriangle size={12} /> {info.asset} only, exact amount — sending any other coin or amount won&apos;t be credited.</p>
          <ol className="list-decimal list-inside space-y-1 fp-text-dim text-[11px] leading-relaxed">
            <li>Scan the QR with the Binance app, or send to the Binance ID above.</li>
            <li>Send exactly <span className="fp-mono fp-text">{breakdown.totalToSend} {info.asset}</span> via Binance Pay (not an on-chain withdrawal).</li>
            <li>After it completes, tap “I’ve paid — verify”.</li>
          </ol>
          <div className="flex items-center gap-2">
            <button onClick={() => { setMsg(null); setStep("verify"); }} disabled={expired} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-70">
              {expired ? "Expired" : "I've paid — verify"}
            </button>
            <button onClick={onDone} className="text-xs fp-text-dim hover:fp-text underline">Cancel</button>
          </div>
        </>
      )}

      {step === "verify" && !done && (
        <>
          <div>
            <label className="fp-text-faint text-[10px] fp-mono uppercase">Enter your Binance Order ID</label>
            <input
              value={orderId}
              onChange={(e) => { setOrderId(e.target.value); setMsg(null); }}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="e.g. 446982297682452480"
              className="w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm fp-mono outline-none focus:border-[rgba(201,165,116,0.35)] text-[#EDEAE2] mt-1"
            />
            <p className="fp-text-faint text-[11px] mt-1.5">Copy the Order ID from your successful Binance C2C payment details, paste it here, then tap Verify.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={verify} disabled={busy || expired} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-70 flex items-center gap-2">
              {busy && <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              {busy ? "Verifying…" : expired ? "Expired" : "Verify payment"}
            </button>
            <button onClick={() => setStep("pay")} className="text-xs fp-text-dim hover:fp-text underline">Back</button>
          </div>
        </>
      )}

      {msg && (
        <p className={`text-xs flex items-center gap-1.5 ${msg.tone === "ok" ? "fp-safe" : msg.tone === "pending" ? "fp-gold" : "text-red-400"}`}>
          {msg.tone === "ok" ? <CheckCircle2 size={13} /> : <Clock size={13} />} {msg.text}
        </p>
      )}

      {done && (
        <button onClick={onDone} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg w-full">Done</button>
      )}
    </div>
  );
}

/* =========================================================
   CUSTOMER DASHBOARD — fully independent from the
   Panel Owner dashboard. Nav: Dashboard, New Order, Orders,
   Wallet, Tickets, API, Profile. No Login/Register here.
   ========================================================= */

type CustomerPage = "dashboard" | "order" | "massorder" | "campaign" | "orders" | "wallet" | "tickets" | "api" | "profile";

const NAV: Array<{ k: CustomerPage; label: string; icon: typeof LayoutGrid }> = [
  { k: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { k: "order", label: "New Order", icon: ShoppingCart },
  { k: "massorder", label: "Mass order", icon: ClipboardList },
  { k: "campaign", label: "Campaign", icon: Zap },
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
  "In progress": "fp-gold-soft-bg fp-gold",
  Pending: "fp-violet-soft-bg fp-violet",
  Partial: "fp-gold-soft-bg fp-gold",
  Duplicate: "bg-amber-500/10 text-amber-300",
  Canceled: "bg-red-500/10 text-red-400",
  Refunded: "bg-red-500/10 text-red-400",
  Failed: "bg-red-500/10 text-red-400",
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
  ordersPageRows,
  ordersPage = 0,
  ordersHasNextPage = false,
  ordersTotalCount,
  ordersAllCount,
  ordersPageBusy = false,
  onOrdersStatusFilterChange,
  onOrdersPageChange,
  walletBalance = customerWallet.balance,
  deposits = customerWallet.deposits,
  tickets = customerTickets,
  recentIds = recentServiceIds,
  username,
  email,
  onUpdateUsername,
  onUpdateEmail,
  onUpdatePassword,
  onPlaceOrder,
  onAddFunds,
  onDeposit,
  onBinanceCreate,
  onBinanceClaim,
  platformMeta,
  currency = "USD",
  paymentMethods = [],
  panelId,
  aiSupport = false,
  campaignEnabled = false,
  dashboardLayout,
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
  /** Optional server-paged orders (storefront-only). Falls back to full local list when unset. */
  ordersPageRows?: CustomerOrder[];
  ordersPage?: number;
  ordersHasNextPage?: boolean;
  ordersTotalCount?: number;
  ordersAllCount?: number;
  ordersPageBusy?: boolean;
  onOrdersStatusFilterChange?: (status: CustomerOrder["status"] | "All") => void;
  onOrdersPageChange?: (page: number) => void;
  walletBalance?: number;
  deposits?: Deposit[];
  tickets?: Ticket[];
  recentIds?: number[];
  username?: string;
  email?: string;
  onUpdateUsername?: (nextUsername: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdateEmail?: (nextEmail: string, currentPassword: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  onUpdatePassword?: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  /** When set, New Order places real orders through this handler. */
  onPlaceOrder?: PlaceOrderHandler;
  onAddFunds?: () => void;
  /** Start a deposit via the given gateway → returns a checkout URL to redirect to. */
  onDeposit?: (amount: number, gateway?: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  /** Binance Pay: create a pending deposit → returns pay-to details (no redirect). */
  onBinanceCreate?: (amount: number) => Promise<{ ok: boolean; data?: BinanceDepositInfo; error?: string }>;
  /** Binance Pay: verify a submitted Binance Order ID → credits the wallet on success. */
  onBinanceClaim?: (paymentId: string, orderId: string) => Promise<BinanceClaimResult>;
  platformMeta?: PlatformMeta;
  /** Panel operating currency (ISO code). */
  currency?: string;
  /** Connected payment methods (id/label/category) for the Add-Funds chooser. */
  paymentMethods?: PaymentMethod[];
  /** Real panel id — when set, the Tickets tab uses the live support system. */
  panelId?: string;
  /** Whether the panel's paid AI support add-on is enabled (shows the chat widget). */
  aiSupport?: boolean;
  /** Whether Campaign Automation (plan) is enabled — shows the Campaign tab. */
  campaignEnabled?: boolean;
  /** Owner-configured home widget layout (Design Tools). Unset = default layout. */
  dashboardLayout?: DashboardWidget[];
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
  const discountRules = useMemo(
    () => [...(activeMethod?.discountRules ?? [])].sort((a, b) => a.minAmount - b.minAmount),
    [activeMethod]
  );
  const discountPct = activeMethod?.discountPct ?? null;
  const depositAmt = Number(depositAmount) || 0;
  const appliedRule = pickDiscountRule(depositAmt, discountRules);
  const appliedDiscountPct = activeMethod?.manual ? null : (appliedRule?.discountPct ?? discountPct);
  const discountBonus = roundMoney(depositAmt * ((appliedDiscountPct ?? 0) / 100));
  const creditedAmount = roundMoney(depositAmt + discountBonus);

  useEffect(() => {
    if (!payGateway && catMethods.length === 1) {
      setPayGateway(catMethods[0].id);
    }
    if (payGateway && !catMethods.some((m) => m.id === payGateway)) {
      setPayGateway("");
    }
  }, [catMethods, payGateway]);

  const [binanceInfo, setBinanceInfo] = useState<BinanceDepositInfo | null>(null);

  const startDeposit = async () => {
    if (depositBusy) return;
    const amt = Number(depositAmount);
    if (!amt || amt <= 0) { setDepositError("Enter an amount."); return; }
    if (paymentMethods.length > 0 && !activeGateway) { setDepositError("Choose a payment method."); return; }
    if (amt < minTopup) { setDepositError(`Minimum top-up for ${activeMethod?.label ?? "this method"} is ${fmt(minTopup)}.`); return; }
    setDepositError(null);
    setDepositBusy(true);

    // Binance Pay: no redirect — create a pending deposit and show the pay-to panel.
    if (activeMethod?.manual) {
      if (!onBinanceCreate) { setDepositBusy(false); setDepositError("This method isn't available right now."); return; }
      const res = await onBinanceCreate(amt);
      setDepositBusy(false);
      if (!res.ok || !res.data) { setDepositError(res.error ?? "Could not start the deposit."); return; }
      setBinanceInfo(res.data);
      return;
    }

    if (!onDeposit) { setDepositBusy(false); return; }
    const res = await onDeposit(amt, activeGateway || undefined);
    if (!res.ok || !res.url) { setDepositBusy(false); setDepositError(res.error ?? "Could not start the deposit."); return; }
    setRedirecting(true); // keep the overlay up through navigation — no flash back to the form
    window.location.href = res.url; // hosted checkout
  };
  const pageStorageKey = `innvil-customer:${panelId ?? "preview"}:page`;
  const readSavedPage = (): CustomerPage => {
    if (typeof window === "undefined") return "dashboard";
    try {
      const raw = window.sessionStorage.getItem(pageStorageKey) ?? window.localStorage.getItem(pageStorageKey);
      if (!raw) return "dashboard";
      return (NAV.some((n) => n.k === raw) ? raw : "dashboard") as CustomerPage;
    } catch {
      return "dashboard";
    }
  };
  const [page, setPage] = useState<CustomerPage>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderFilter, setOrderFilter] = useState<CustomerOrder["status"] | "All">("All");
  const [usernameInput, setUsernameInput] = useState(username ?? (email ? email.split("@")[0] : ""));
  const [emailInput, setEmailInput] = useState(email ?? "");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [profileBusy, setProfileBusy] = useState<"username" | "email" | "password" | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ card: "username" | "email" | "password"; ok: boolean; text: string } | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<number[]>(
    () => initialFavoriteIds.filter((id) => services.some((s) => s.id === id))
  );
  const [prefillServiceId, setPrefillServiceId] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(initialApiKey);
  const [keyRegenerated, setKeyRegenerated] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [savedCard, setSavedCard] = useState<string | null>(null);

  useEffect(() => {
    setPage(readSavedPage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(pageStorageKey, page);
      window.localStorage.setItem(pageStorageKey, page);
    } catch {
      // ignore storage failures
    }
  }, [pageStorageKey, page]);

  useEffect(() => {
    setUsernameInput(username ?? (email ? email.split("@")[0] : ""));
  }, [username, email]);

  useEffect(() => {
    setEmailInput(email ?? "");
  }, [email]);

  const saveUsername = async () => {
    const next = usernameInput.trim();
    if (!next) {
      setProfileMsg({ card: "username", ok: false, text: "Enter a username." });
      return;
    }
    if (!onUpdateUsername) {
      setSavedCard("username");
      return;
    }
    setProfileBusy("username");
    setProfileMsg(null);
    const res = await onUpdateUsername(next);
    setProfileBusy(null);
    if (!res.ok) {
      setProfileMsg({ card: "username", ok: false, text: res.error ?? "Could not update username." });
      return;
    }
    setSavedCard("username");
    setProfileMsg({ card: "username", ok: true, text: "Username updated." });
  };

  const saveEmail = async () => {
    if (!onUpdateEmail) {
      setSavedCard("email");
      return;
    }
    setProfileBusy("email");
    setProfileMsg(null);
    const res = await onUpdateEmail(emailInput, emailCurrentPassword);
    setProfileBusy(null);
    if (!res.ok) {
      setProfileMsg({ card: "email", ok: false, text: res.error ?? "Could not update email." });
      return;
    }
    setSavedCard("email");
    setEmailCurrentPassword("");
    setProfileMsg({ card: "email", ok: true, text: res.message ?? "Email update requested." });
  };

  const savePassword = async () => {
    if (pwNext !== pwConfirm) {
      setProfileMsg({ card: "password", ok: false, text: "Passwords do not match." });
      return;
    }
    if (!onUpdatePassword) {
      setSavedCard("password");
      return;
    }
    setProfileBusy("password");
    setProfileMsg(null);
    const res = await onUpdatePassword(pwCurrent, pwNext);
    setProfileBusy(null);
    if (!res.ok) {
      setProfileMsg({ card: "password", ok: false, text: res.error ?? "Could not update password." });
      return;
    }
    setSavedCard("password");
    setPwCurrent(""); setPwNext(""); setPwConfirm("");
    setProfileMsg({ card: "password", ok: true, text: "Password updated." });
  };

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

  const processingCount = orders.filter((o) => o.status === "Processing").length;
  const inProgressCount = orders.filter((o) => o.status === "In progress").length;
  const pendingCount = orders.filter((o) => o.status === "Pending").length;
  const completedToday = orders.filter(
    (o) => o.status === "Completed" && o.date.startsWith("Today")
  ).length;
  const canceledCount = orders.filter((o) => o.status === "Canceled").length;

  const orderFilterOptions = [
    "All",
    "Pending",
    "Processing",
    "In progress",
    "Completed",
    "Partial",
    "Duplicate",
    "Canceled",
    "Refunded",
    "Failed",
  ] as const;
  const hasServerOrderPaging = typeof onOrdersStatusFilterChange === "function" && typeof onOrdersPageChange === "function";
  const currentOrderRows = hasServerOrderPaging ? (ordersPageRows ?? []) : orders;
  const filteredOrders = hasServerOrderPaging
    ? currentOrderRows
    : (orderFilter === "All" ? currentOrderRows : currentOrderRows.filter((o) => o.status === orderFilter));
  const allOrdersTotal = hasServerOrderPaging ? (ordersAllCount ?? currentOrderRows.length) : orders.length;
  const filterTotal = hasServerOrderPaging
    ? (ordersTotalCount ?? filteredOrders.length)
    : filteredOrders.length;

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {
      All: hasServerOrderPaging ? (ordersAllCount ?? currentOrderRows.length) : orders.length,
      Pending: 0,
      Processing: 0,
      "In progress": 0,
      Completed: 0,
      Partial: 0,
      Duplicate: 0,
      Canceled: 0,
      Refunded: 0,
      Failed: 0,
    };
    for (const o of currentOrderRows) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [currentOrderRows, hasServerOrderPaging, orders.length, ordersAllCount]);

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
              <DefaultLogo className="w-7 h-7 rounded-md" iconSize={14} />
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
        {page === "dashboard" && (() => {
          const wStats = (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {[
                { label: "Wallet balance", value: fmt(walletBalance), tone: "fp-gold" },
                { label: "Pending", value: String(pendingCount), tone: "fp-violet" },
                { label: "Processing", value: String(processingCount), tone: "fp-gold" },
                { label: "In progress", value: String(inProgressCount), tone: "fp-gold" },
                { label: "Completed today", value: String(completedToday), tone: "fp-safe" },
                { label: "Canceled", value: String(canceledCount), tone: "" },
              ].map((s) => (
                <div key={s.label} className="fp-panel border fp-line rounded-2xl p-4">
                  <p className="fp-text-faint text-[11px] fp-mono uppercase tracking-wide">{s.label}</p>
                  <p className={`fp-display text-2xl mt-1.5 ${s.tone}`}>{s.value}</p>
                </div>
              ))}
            </div>
          );
          const wFavorites = (
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
                  <button onClick={() => go("order")} className="text-sm fp-violet">
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
          );
          const wRecent = (
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
          );
          const wOrders = (
            <div className="fp-panel border fp-line rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="fp-display text-lg">Recent orders</p>
                <button onClick={() => go("orders")} className="text-xs fp-violet">View all →</button>
              </div>
              <OrderRows orders={orders.slice(0, 3)} services={services} onReorder={quickOrder} compact platformMeta={platformMeta} />
            </div>
          );
          const byId: Record<string, React.ReactNode> = { stats: wStats, favorites: wFavorites, recent: wRecent, orders: wOrders };

          // Owner-customized layout (Design Tools): render visible widgets in order,
          // each full-width. Default (unset): the original stats → fav+recent → orders.
          if (dashboardLayout) {
            return (
              <div className="space-y-6">
                {dashboardLayout.filter((w) => w.visible).map((w) => (
                  <div key={w.id}>{byId[w.id]}</div>
                ))}
              </div>
            );
          }
          return (
            <div className="space-y-6">
              {wStats}
              <div className="grid lg:grid-cols-2 gap-6">{wFavorites}{wRecent}</div>
              {wOrders}
            </div>
          );
        })()}

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

        {/* ---------- MASS ORDER ---------- */}
        {page === "massorder" && (
          <MassOrder panelId={panelId} currency={currency} />
        )}

        {/* ---------- CAMPAIGN ---------- */}
        {page === "campaign" && (
          <CampaignSurface panelId={panelId} currency={currency} onContactSupport={() => go("tickets")} />
        )}

        {/* ---------- ORDERS ---------- */}
        {page === "orders" && (
          <div className="fp-panel border fp-line rounded-2xl p-5">
            <p className="fp-display text-lg mb-4">Order history</p>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
              {orderFilterOptions.map((status) => {
                const count = statusCounts[status] ?? 0;
                const active = orderFilter === status;
                return (
                  <button
                    key={status}
                    onClick={() => {
                      setOrderFilter(status);
                      if (hasServerOrderPaging) {
                        onOrdersStatusFilterChange?.(status);
                        onOrdersPageChange?.(0);
                      }
                    }}
                    className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      active
                        ? "fp-violet-soft-bg fp-violet border-[rgba(139,127,255,0.45)]"
                        : "fp-panel-raised fp-text-dim border-[#262A35] hover:fp-text"
                    }`}
                  >
                    {status} <span className="fp-mono">{count}</span>
                  </button>
                );
              })}
            </div>
            {allOrdersTotal === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm fp-text-dim mb-3">You haven&apos;t placed any orders yet.</p>
                <button onClick={() => go("order")} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg">
                  Place your first order
                </button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm fp-text-dim mb-3">No orders match the selected status.</p>
                <button
                  onClick={() => {
                    setOrderFilter("All");
                    if (hasServerOrderPaging) {
                      onOrdersStatusFilterChange?.("All");
                      onOrdersPageChange?.(0);
                    }
                  }}
                  className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg"
                >
                  Show all orders
                </button>
              </div>
            ) : (
              <>
                <OrderRows orders={filteredOrders} services={services} onReorder={quickOrder} />
                {hasServerOrderPaging && (
                  <div className="mt-4 pt-3 border-t fp-line-soft flex items-center justify-between gap-2">
                    <div className="text-xs fp-text-faint fp-mono">
                      {filteredOrders.length}/{filterTotal} orders{ordersPageBusy ? " · Syncing…" : ""}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOrdersPageChange?.(Math.max(0, ordersPage - 1))}
                        disabled={ordersPage <= 0 || ordersPageBusy}
                        className="text-xs fp-text-dim border fp-line-soft rounded-lg px-2.5 py-1.5 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => onOrdersPageChange?.(ordersPage + 1)}
                        disabled={!ordersHasNextPage || ordersPageBusy}
                        className="text-xs fp-text-dim border fp-line-soft rounded-lg px-2.5 py-1.5 disabled:opacity-50"
                      >
                        Next
                      </button>
                      <span className="text-[11px] fp-text-faint fp-mono">Page {ordersPage + 1}</span>
                    </div>
                  </div>
                )}
              </>
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
                      {discountRules.length > 0 && <> · Promo: <span className="fp-safe">Tiered</span></>}
                      {discountRules.length === 0 && discountPct != null && <> · Promo: <span className="fp-safe">+{discountPct}%</span></>}
                    </p>
                  )}

                  {discountRules.length > 0 && (
                    <details className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
                      <summary className="cursor-pointer text-xs fp-text-dim">Show promo tiers</summary>
                      <div className="mt-2 grid sm:grid-cols-2 gap-2">
                        {discountRules.map((r) => (
                          <div key={`${r.minAmount}-${r.discountPct}`} className="text-xs fp-text-faint border fp-line-soft rounded-md px-2.5 py-1.5">
                            Top-up ≥ <span className="fp-text fp-mono">{fmt(r.minAmount)}</span> → <span className="fp-safe">+{r.discountPct}%</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {appliedDiscountPct != null && depositAmt > 0 && (
                    <p className="fp-safe text-xs">
                      Top-up {fmt(depositAmt)} + bonus {fmt(discountBonus)} = you receive {fmt(creditedAmount)}
                      {appliedRule && <span className="fp-text-faint"> · Applied tier: ≥ {fmt(appliedRule.minAmount)}</span>}
                    </p>
                  )}

                  {binanceInfo ? (
                    <BinancePayPanel
                      info={binanceInfo}
                      onClaim={onBinanceClaim}
                      onDone={() => { setBinanceInfo(null); setDepositAmount(""); }}
                    />
                  ) : (
                  <>
                  {activeMethod?.manual && (
                    <p className="fp-text-faint text-[11px] leading-relaxed">
                      <span className="fp-gold">USDT only.</span> Pay with Binance Pay (not an on-chain withdrawal) — you&apos;ll get the exact amount and details next.
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
                      {redirecting ? "Redirecting…" : depositBusy ? (activeMethod?.manual ? "Preparing…" : "Opening…") : (activeMethod?.manual ? "Continue" : "Add funds")}
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
                    <p className="fp-text-faint text-[11px]">{activeMethod?.manual ? "Enter the amount you'll send, then you'll get the Binance Pay details." : "You'll be sent to a secure checkout. Your balance updates automatically once the payment confirms."}</p>
                  )}
                  </>
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
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className={profileInputCls}
              />
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={saveUsername}
                  disabled={profileBusy === "username"}
                  className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60"
                >
                  {profileBusy === "username" ? "Saving…" : "Save username"}
                </button>
                {savedCard === "username" && (
                  <span className="text-xs fp-safe flex items-center gap-1">
                    <CheckCircle2 size={12} /> Saved
                  </span>
                )}
              </div>
              {profileMsg?.card === "username" && (
                <p className={`text-xs mt-2 ${profileMsg.ok ? "fp-safe" : "text-red-400"}`}>{profileMsg.text}</p>
              )}
            </div>

            {/* Email */}
            <div className="fp-panel border fp-line rounded-2xl p-6">
              <p className="fp-display text-lg mb-1">Email</p>
              <p className="text-xs fp-text-dim mb-5">
                We&apos;ll send a confirmation link to the new address before it takes effect.
              </p>
              <div className="space-y-3">
                <input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} type="email" className={profileInputCls} />
                <input value={emailCurrentPassword} onChange={(e) => setEmailCurrentPassword(e.target.value)} placeholder="Current password" type="password" className={profileInputCls} />
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={saveEmail}
                  disabled={profileBusy === "email"}
                  className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60"
                >
                  {profileBusy === "email" ? "Saving…" : "Change email"}
                </button>
                {savedCard === "email" && (
                  <span className="text-xs fp-safe flex items-center gap-1">
                    <CheckCircle2 size={12} /> Confirmation sent
                  </span>
                )}
              </div>
              {profileMsg?.card === "email" && (
                <p className={`text-xs mt-2 ${profileMsg.ok ? "fp-safe" : "text-red-400"}`}>{profileMsg.text}</p>
              )}
            </div>

            {/* Password */}
            <div className="fp-panel border fp-line rounded-2xl p-6">
              <p className="fp-display text-lg mb-5">Change password</p>
              <div className="space-y-3">
                <input value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} placeholder="Current password" type="password" className={profileInputCls} />
                <input value={pwNext} onChange={(e) => setPwNext(e.target.value)} placeholder="New password" type="password" className={profileInputCls} />
                <input value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="Confirm new password" type="password" className={profileInputCls} />
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={savePassword}
                  disabled={profileBusy === "password"}
                  className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60"
                >
                  {profileBusy === "password" ? "Saving…" : "Update password"}
                </button>
                {savedCard === "password" && (
                  <span className="text-xs fp-safe flex items-center gap-1">
                    <CheckCircle2 size={12} /> Password updated
                  </span>
                )}
              </div>
              {profileMsg?.card === "password" && (
                <p className={`text-xs mt-2 ${profileMsg.ok ? "fp-safe" : "text-red-400"}`}>{profileMsg.text}</p>
              )}
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

      {aiSupport && panelId && <SupportChat panelId={panelId} brandName={brandName} />}
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
  const [popup, setPopup] = useState<{ title: string; lines: string[] } | null>(null);
  const linkHref = (link: string) => {
    try { return new URL(link).toString(); } catch { return null; }
  };
  const showService = (o: CustomerOrder) => setPopup({
    title: "Service details",
    lines: [o.service, o.serviceNo != null ? `Service #${o.serviceNo}` : "", `Quantity: ${o.qty.toLocaleString()}`, `Link: ${o.link}`].filter(Boolean),
  });
  return (
    <div>
      {popup && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setPopup(null)}>
          <div className="fp-panel border fp-line rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b fp-line-soft">
              <p className="fp-display text-sm">{popup.title}</p>
              <button onClick={() => setPopup(null)} className="fp-text-faint hover:fp-text"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-1.5">
              {popup.lines.map((l, i) => {
                const match = l.match(/^Link:\s*(.+)$/i);
                const href = match ? linkHref(match[1]) : null;
                return href ? (
                  <a key={i} href={href} target="_blank" rel="noreferrer noopener" className="text-sm fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 break-words hover:fp-gold underline underline-offset-2">
                    {l}
                  </a>
                ) : (
                  <p key={i} className="text-sm fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 break-words">{l}</p>
                );
              })}
            </div>
          </div>
        </div>
      )}
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
              <p className="text-sm truncate flex items-center gap-1.5">
                <button onClick={() => showService(o)} className="truncate hover:fp-gold text-left" title="View service">{o.service}</button>
                {o.serviceNo != null && <span className="fp-text-faint text-xs shrink-0">#{o.serviceNo}</span>}
                {o.comments && o.comments.length > 0 && (
                  <button onClick={() => setPopup({ title: `Comments (${o.comments!.length})`, lines: o.comments! })} title="View comments" className="fp-gold shrink-0"><FileText size={12} /></button>
                )}
              </p>
              <p className="text-xs fp-text-faint fp-mono mt-0.5 truncate">
                #{o.id} · {o.qty.toLocaleString()} · {o.date}
                {!compact && (
                  <>
                    {" · "}
                    {linkHref(o.link) ? (
                      <a
                        href={linkHref(o.link) ?? undefined}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-2 hover:fp-gold break-all"
                        title={o.link}
                      >
                        {o.link}
                      </a>
                    ) : (
                      <span title={o.link}>{o.link}</span>
                    )}
                  </>
                )}
              </p>
              {o.failReason && (o.status === "Canceled" || o.status === "Refunded" || o.status === "Duplicate" || o.status === "Failed") && (
                <p className="text-[11px] text-red-400 mt-0.5 truncate">Reason: {o.failReason}</p>
              )}
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
