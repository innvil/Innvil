"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Gauge, Zap, ShieldCheck, Wallet, Clock,
  AlertTriangle, CheckCircle2, ChevronDown, Loader2,
  TrendingUp, CreditCard, Search, UserPlus,
} from "lucide-react";
import { PlatformKey, CustomerService, CustomerOrder } from "@/src/data/constants";
import { PlatformGlyph, PlatformButton } from "@/src/components/customer/PlatformIcons";
import { CustomerDashboard } from "@/src/components/customer/CustomerDashboard";
import type { PlaceOrderArgs } from "@/src/components/customer/NewOrder";
import type { StorefrontService, StorefrontPlatformMeta, PublicPaymentMethod, PublicLandingSection } from "@/src/lib/actions/storefront";
import type { DashboardWidget } from "@/src/lib/dashboard-layout";
import { placeOrder, listCustomerOrdersPage, type CustomerOrderVM } from "@/src/lib/actions/orders";
import { createDeposit, type DepositVM } from "@/src/lib/actions/payments";
import { createBinanceDeposit, claimBinancePayment } from "@/src/lib/actions/binance-pay";
import { formatMoney } from "@/src/lib/money";
import type { OrderStatus } from "@/src/types/db";
import {
  customerUpdateDisplayName, customerUpdateEmail, customerUpdatePassword,
  type CustomerAccountInfo,
} from "@/src/lib/actions/customer-auth";
import { rotateCustomerApiKey } from "@/src/lib/actions/customer-api";
import { createStorefrontClient } from "@/src/lib/supabase/client";
import { DefaultLogo } from "@/src/components/ui/BrandMark";

// Nice display labels for the platform keys the import produces. Owner-set labels
// (platformMeta) win; then this map; then a title-cased fallback for anything new.
// Real platforms ALWAYS get their own named tab — only truly platform-less services
// (key "other", e.g. website traffic) fall into the "Other" bucket.
const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X",
  facebook: "Facebook", telegram: "Telegram", spotify: "Spotify", linkedin: "LinkedIn",
  twitch: "Twitch", discord: "Discord", reddit: "Reddit", pinterest: "Pinterest",
  snapchat: "Snapchat", threads: "Threads", soundcloud: "SoundCloud", kick: "Kick",
  rumble: "Rumble", bluesky: "Bluesky", other: "Other",
};
function labelForPlatform(key: string, meta?: StorefrontPlatformMeta): string {
  const custom = meta?.[key]?.label;
  if (custom && custom.trim()) return custom;
  return PLATFORM_LABELS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

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
  in_progress: "In progress",
  partial: "Partial",
  completed: "Completed",
  canceled: "Canceled",
  failed: "Failed",
  refunded: "Refunded",
  duplicate: "Duplicate",
};

const STOREFRONT_ORDERS_PAGE_SIZE = 50;

const UI_TO_DB_ORDER_STATUS: Record<CustomerOrder["status"] | "All", OrderStatus | "all"> = {
  All: "all",
  Pending: "pending",
  Processing: "processing",
  "In progress": "in_progress",
  Completed: "completed",
  Partial: "partial",
  Duplicate: "duplicate",
  Canceled: "canceled",
  Refunded: "refunded",
  Failed: "failed",
};

function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type StorefrontSnapshotResponse = {
  ok: boolean;
  snapshot?: {
    balance: number;
    deposits: DepositVM[];
    orders: CustomerOrderVM[];
    apiEnabled: boolean;
    apiHasKey: boolean;
    accountStatus: string;
    panelStatus: string;
    updatedAt: string;
  };
};

function readStorefrontAccessTokenFromCookie(): string | null {
  try {
    const raw = document.cookie
      .split("; ")
      .find((v) => v.startsWith("ll-store-auth="));
    if (!raw) return null;
    const encoded = decodeURIComponent(raw.slice("ll-store-auth=".length));
    const payload = JSON.parse(atob(encoded.replace(/^base64-/, ""))) as { access_token?: string };
    return typeof payload.access_token === "string" && payload.access_token
      ? payload.access_token
      : null;
  } catch {
    return null;
  }
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
  panel: { id: string; subdomain: string; name: string; status: string; currency: string; logoUrl?: string; headline?: string; description?: string; sections?: PublicLandingSection[]; aiSupport?: boolean; campaignAutomation?: boolean; dashboardLayout?: DashboardWidget[] | null };
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
  const supabase = useMemo(() => createStorefrontClient(), []);
  const inactive = panel.status === "inactive";
  const [optimisticSignedOut, setOptimisticSignedOut] = useState(false);
  const [clientSignedIn, setClientSignedIn] = useState(false);
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [authBooting, setAuthBooting] = useState(true);
  const [hasCachedSnapshot, setHasCachedSnapshot] = useState(false);
  const [hasSessionHint, setHasSessionHint] = useState(false);
  const account = optimisticSignedOut ? null : initialAccount; // re-fetched by the server after auth via router.refresh()
  const showCachedDashboard = authBooting && hasCachedSnapshot && hasSessionHint;
  const signedIn = !!account || clientSignedIn || showCachedDashboard;
  const fmt = (n: number) => formatMoney(n, panel.currency);
  const [liveBalance, setLiveBalance] = useState(account?.balance ?? 0);
  const [liveDeposits, setLiveDeposits] = useState<DepositVM[]>(initialDeposits);
  const [liveOrders, setLiveOrders] = useState<CustomerOrderVM[]>(initialOrders);
  const [ordersFilter, setOrdersFilter] = useState<CustomerOrder["status"] | "All">("All");
  const [ordersPage, setOrdersPage] = useState(0);
  const [ordersPageRows, setOrdersPageRows] = useState<CustomerOrderVM[]>(initialOrders.slice(0, STOREFRONT_ORDERS_PAGE_SIZE));
  const [ordersPageHasNext, setOrdersPageHasNext] = useState(initialOrders.length > STOREFRONT_ORDERS_PAGE_SIZE);
  const [ordersPageTotal, setOrdersPageTotal] = useState(initialOrders.length);
  const [ordersPageAll, setOrdersPageAll] = useState(initialOrders.length);
  const [ordersPageBusy, setOrdersPageBusy] = useState(false);
  const [apiEnabled, setApiEnabled] = useState(customerApiEnabled);
  const [apiHasKey, setApiHasKey] = useState(customerApiHasKey);

  useEffect(() => {
    // Don't zero out cached UI during auth/bootstrap; only trust server balance when account is present.
    if (account) setLiveBalance(account.balance);
  }, [account]);

  useEffect(() => {
    // Don't let empty server defaults wipe populated client snapshot/live state.
    if (!account) return;
    if (initialDeposits.length > 0) setLiveDeposits(initialDeposits);
  }, [account, initialDeposits]);

  useEffect(() => {
    // Don't let empty server defaults wipe populated client snapshot/live state.
    if (!account) return;
    if (initialOrders.length > 0) setLiveOrders(initialOrders);
  }, [account, initialOrders]);

  useEffect(() => {
    if (!account) return;
    setApiEnabled(customerApiEnabled);
    setApiHasKey(customerApiHasKey);
  }, [account, customerApiEnabled, customerApiHasKey]);

  useEffect(() => {
    if (initialAccount) setOptimisticSignedOut(false);
  }, [initialAccount]);

  useEffect(() => {
    if (account) {
      setClientSignedIn(true);
      setClientEmail(account.email ?? null);
    }
  }, [account]);

  useEffect(() => {
    let mounted = true;
    const bootstrapSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const user = data.session?.user ?? null;
      setClientSignedIn(!!user);
      setClientEmail(user?.email ?? null);
      setAuthBooting(false);
    };
    void bootstrapSession();
    return () => {
      mounted = false;
    };
  }, [supabase.auth]);

  // ---- Live data → customer dashboard shapes -------------------------------
  const uiServices = useMemo(() => services.map(toCustomerService), [services]);
  const uuidToLocalId = useMemo(() => {
    const m = new Map<string, number>();
    uiServices.forEach((s) => { if (s.uuid) m.set(s.uuid, s.id); });
    return m;
  }, [uiServices]);

  const uiOrders: CustomerOrder[] = useMemo(
    () =>
      liveOrders.map((o) => ({
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
    [liveOrders, uuidToLocalId]
  );

  const uiPagedOrders: CustomerOrder[] = useMemo(
    () =>
      ordersPageRows.map((o) => ({
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
    [ordersPageRows, uuidToLocalId]
  );

  const loadOrdersPage = useCallback(async (status: CustomerOrder["status"] | "All", page: number) => {
    if (!signedIn) return;
    setOrdersPageBusy(true);
    try {
      const res = await listCustomerOrdersPage(panel.id, {
        status: UI_TO_DB_ORDER_STATUS[status],
        page,
        pageSize: STOREFRONT_ORDERS_PAGE_SIZE,
      });
      setOrdersPageRows(res.rows);
      setOrdersPageHasNext(res.hasNext);
      setOrdersPageTotal(res.totalCount);
      setOrdersPageAll(res.allCount);
    } finally {
      setOrdersPageBusy(false);
    }
  }, [panel.id, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    void loadOrdersPage(ordersFilter, ordersPage);
  }, [signedIn, panel.id, ordersFilter, ordersPage, loadOrdersPage]);

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

  const handleBinanceCreate = async (amount: number) => {
    const res = await createBinanceDeposit(panel.id, amount);
    return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
  };

  const refreshWalletFromSnapshot = async () => {
    const snap = await fetchBackendSnapshot();
    if (snap) {
      setLiveBalance(snap.balance);
      setLiveDeposits(Array.isArray(snap.deposits) ? snap.deposits : []);
    }
  };

  const handleBinanceClaim = async (paymentId: string, orderId: string) => {
    const res = await claimBinancePayment(panel.id, paymentId, orderId);
    if (res.ok) await refreshWalletFromSnapshot();
    return res;
  };

  const rotateApiKey = async () => {
    const res = await rotateCustomerApiKey(panel.id);
    if (res.ok) {
      setApiEnabled(true);
      setApiHasKey(true);
      return { ok: true, key: res.key };
    }
    return { ok: false, error: res.error };
  };

  const fetchBackendSnapshot = useCallback(async (): Promise<StorefrontSnapshotResponse["snapshot"] | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? readStorefrontAccessTokenFromCookie();
    if (!token) return null;

    const resp = await fetch("/api/storefront/snapshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ panelId: panel.id }),
      cache: "no-store",
    });
    if (!resp.ok) return null;

    const json = (await resp.json()) as StorefrontSnapshotResponse;
    if (!json.ok || !json.snapshot) return null;
    return json.snapshot;
  }, [panel.id, supabase.auth]);

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
    if (!signedIn) return;
    let cancelled = false;
    const bootstrapSignedInData = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const snap = await fetchBackendSnapshot();
        if (cancelled) return;
        if (snap) {
          setLiveBalance(snap.balance);
          setLiveDeposits(Array.isArray(snap.deposits) ? snap.deposits : []);
          setLiveOrders(Array.isArray(snap.orders) ? snap.orders : []);
          setApiEnabled(snap.apiEnabled);
          setApiHasKey(snap.apiHasKey);
          return;
        }
        if (attempt === 3) return;
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      }
    };
    void bootstrapSignedInData();
    return () => {
      cancelled = true;
    };
  }, [signedIn, panel.id, fetchBackendSnapshot]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const poll = async () => {
      const snap = await fetchBackendSnapshot();
      if (!snap || cancelled) return;
      setLiveBalance(snap.balance);
      setLiveDeposits(Array.isArray(snap.deposits) ? snap.deposits : []);
      setApiEnabled(snap.apiEnabled);
      setApiHasKey(snap.apiHasKey);
    };

    poll();
    const id = window.setInterval(poll, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [signedIn, panel.id, fetchBackendSnapshot]);

  useEffect(() => {
    if (!signedIn) return;

    let cancelled = false;
    const pollOrders = async () => {
      const snap = await fetchBackendSnapshot();
      if (!snap || cancelled) return;
      setLiveOrders(Array.isArray(snap.orders) ? snap.orders : []);
    };

    pollOrders();
    const id = window.setInterval(pollOrders, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [signedIn, panel.id, fetchBackendSnapshot]);

  useEffect(() => {
    const cacheKey = `storefront:${panel.id}:snapshot`;
    const hintKey = `storefront:${panel.id}:session-hint`;
    try {
      setHasSessionHint(window.localStorage.getItem(hintKey) === "1");
      const raw = window.localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          balance?: number;
          deposits?: DepositVM[];
          orders?: CustomerOrderVM[];
        };
        setHasCachedSnapshot(true);
        if (typeof parsed.balance === "number") setLiveBalance(parsed.balance);
        if (Array.isArray(parsed.deposits)) setLiveDeposits(parsed.deposits);
        if (Array.isArray(parsed.orders)) setLiveOrders(parsed.orders);
      } else {
        setHasCachedSnapshot(false);
      }
    } catch {
      // ignore bad cache
    }
  }, [panel.id]);

  useEffect(() => {
    const cacheKey = `storefront:${panel.id}:snapshot`;
    try {
      window.localStorage.setItem(
        cacheKey,
        JSON.stringify({
          balance: liveBalance,
          deposits: liveDeposits,
          orders: liveOrders,
        })
      );
    } catch {
      // ignore storage failures
    }
  }, [panel.id, liveBalance, liveDeposits, liveOrders]);

  // Group services by platform for the showcase
  const groups = useMemo(() => {
    const m = new Map<string, StorefrontService[]>();
    for (const s of services) {
      // Trust the import's platform assignment: any real platform (linkedin, twitch,
      // reddit, …) keeps its own group. Only genuinely platform-less services — which
      // the import already tags "other" (e.g. website traffic) — land in "Other".
      const k = s.platform && s.platform.trim() && s.platform !== "other" ? s.platform : "other";
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return m;
  }, [services]);
  const platformKeys = useMemo(() => {
    // Real platforms keep their discovery order; the catch-all "Other" always sits last.
    return [...groups.keys()].sort((a, b) => (a === "other" ? 1 : b === "other" ? -1 : 0));
  }, [groups]);
  const [activeP, setActiveP] = useState("");
  const active = activeP || platformKeys[0] || "";
  const shown = (groups.get(active) ?? []).slice(0, 10);

  // Real, honest storefront stats derived from this panel's live catalog.
  const platformCount = useMemo(() => platformKeys.filter((k) => k !== "other").length, [platformKeys]);
  const lowestPrice = useMemo(() => {
    const prices = services.map((s) => s.price).filter((p) => Number.isFinite(p) && p > 0);
    return prices.length ? Math.min(...prices) : 0;
  }, [services]);
  const landingStats = useMemo(() => {
    const out: Array<{ label: string; value: string }> = [{ label: "Services", value: services.length.toLocaleString() }];
    if (platformCount > 0) out.push({ label: "Platforms", value: String(platformCount) });
    if (lowestPrice > 0) out.push({ label: "Starting from", value: `${fmt(lowestPrice)}/1k` });
    out.push({ label: "Delivery", value: "24/7" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.length, platformCount, lowestPrice]);

  // Auth
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [authPhase, setAuthPhase] = useState<"idle" | "auth" | "redirect">("idle");
  const [error, setError] = useState<string | null>(null);

  const submitAuth = async () => {
    if (busy) return;
    setError(null);
    setAuthPhase("idle");
    if (!email || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    setAuthPhase("auth");
    let redirecting = false;
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
      } else {
        redirecting = true;
        setAuthPhase("redirect");
        setClientSignedIn(true);
        setClientEmail(email.trim());
        setHasSessionHint(true);
        try {
          window.localStorage.setItem(`storefront:${panel.id}:session-hint`, "1");
        } catch {
          // ignore storage failures
        }
        setBusy(false);
        setAuthPhase("idle");
        router.refresh();
        window.setTimeout(() => {
          router.refresh();
        }, 900);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      if (!redirecting) {
        setBusy(false);
        setAuthPhase("idle");
      }
    }
  };

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setClientSignedIn(false);
        setClientEmail(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setClientSignedIn(true);
        setClientEmail(session?.user?.email ?? null);
        router.refresh();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [router, supabase.auth]);

  const logout = () => {
    setOptimisticSignedOut(true);
    setClientSignedIn(false);
    setClientEmail(null);
    setHasSessionHint(false);
    try {
      window.localStorage.removeItem(`storefront:${panel.id}:session-hint`);
    } catch {
      // ignore storage failures
    }
    void supabase.auth.signOut().finally(() => {
      router.refresh();
    });
  };

  const scrollToAuth = () => {
    document.getElementById("nb-auth")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
              <Gauge size={20} />
            </span>
            <span className="text-[11px]">Other</span>
          </button>
        ) : (
          <PlatformButton
            key={k}
            platform={k as PlatformKey}
            label={labelForPlatform(k, platformMeta)}
            active={active === k}
            onClick={() => setActiveP(k)}
            pathOverride={platformMeta?.[k]?.icon ?? null}
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
  if (signedIn) {
    return (
      <CustomerDashboard
        canOrder={!!account && panel.status === "live" && account.status === "active"}
        inactive={inactive}
        onLogout={logout}
        brandName={panel.name}
        logoUrl={panel.logoUrl}
        services={uiServices}
        orders={uiOrders}
        ordersPageRows={uiPagedOrders}
        ordersPage={ordersPage}
        ordersHasNextPage={ordersPageHasNext}
        ordersTotalCount={ordersPageTotal}
        ordersAllCount={ordersPageAll}
        ordersPageBusy={ordersPageBusy}
        onOrdersStatusFilterChange={(next) => {
          setOrdersFilter(next);
          setOrdersPage(0);
        }}
        onOrdersPageChange={setOrdersPage}
        walletBalance={liveBalance}
        deposits={uiDeposits}
        tickets={[]}
        recentIds={recentIds}
        username={account?.username ?? undefined}
        email={account?.email ?? clientEmail ?? undefined}
        onUpdateUsername={async (next) => {
          const res = await customerUpdateDisplayName(next);
          if (res.ok) router.refresh();
          return res.ok ? { ok: true } : { ok: false, error: res.error };
        }}
        onUpdateEmail={async (nextEmail, currentPassword) => {
          const res = await customerUpdateEmail(nextEmail, currentPassword);
          if (res.ok) router.refresh();
          return res.ok
            ? { ok: true, message: res.needsConfirmation ? "Check your inbox to confirm your new email." : "Email updated." }
            : { ok: false, error: res.error };
        }}
        onUpdatePassword={async (currentPassword, nextPassword) => {
          const res = await customerUpdatePassword(currentPassword, nextPassword);
          return res.ok ? { ok: true } : { ok: false, error: res.error };
        }}
        onPlaceOrder={handlePlaceOrder}
        onDeposit={handleDeposit}
        onBinanceCreate={handleBinanceCreate}
        onBinanceClaim={handleBinanceClaim}
        platformMeta={platformMeta}
        currency={panel.currency}
        paymentMethods={paymentMethods}
        panelId={panel.id}
        aiSupport={panel.aiSupport ?? false}
        campaignEnabled={panel.campaignAutomation ?? false}
        dashboardLayout={panel.dashboardLayout ?? undefined}
        apiEnabled={apiEnabled}
        hasExistingApiKey={apiHasKey}
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
          <button onClick={scrollToAuth} className="flex items-center gap-2.5 text-left">
            {panel.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={panel.logoUrl} alt={panel.name} className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <DefaultLogo className="w-8 h-8 rounded-lg" iconSize={16} />
            )}
            <span className="fp-display text-xl">{panel.name}</span>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={scrollToAuth} className="text-sm px-4 py-2 rounded-lg fp-violet-soft-bg fp-violet">
              Log in
            </button>
            <Link href={`/p/${panel.subdomain}/signup`} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">Create account</Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 md:py-20 grid md:grid-cols-2 gap-12 items-start">
        <div>
          <h1 className="fp-display text-4xl md:text-5xl leading-tight mb-5">{panel.headline || "Grow every platform from one wallet."}</h1>
          <p className="fp-text-dim text-lg mb-8 leading-relaxed">{panel.description || `Instant delivery, transparent pricing, and one balance for all your social growth on ${panel.name}.`}</p>
          <div className="flex gap-3 flex-wrap mb-10">
            {platformKeys.filter((k) => k !== "other").map((k) => (
              <span key={k} className="w-11 h-11 rounded-xl fp-panel-raised border border-[#262A35] flex items-center justify-center fp-text-dim" title={labelForPlatform(k, platformMeta)}>
                <PlatformGlyph platform={k} size={18} pathOverride={platformMeta?.[k]?.icon ?? null} />
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
            aria-busy={busy}
          >
            <input disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" autoComplete={`section-innvil-customer-${panel.id} username`} placeholder="Email" className={`${inputCls} mb-3`} />
            <input disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="password" autoComplete={`section-innvil-customer-${panel.id} current-password`} placeholder="Password" className={`${inputCls} mb-2`} />
            <div className="flex justify-end mb-4">
              <Link href={`/p/${panel.subdomain}/forgot-password`} className="fp-text-faint text-xs hover:fp-text">
                Forgot password?
              </Link>
            </div>
            {error && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
            <button type="submit" disabled={busy} className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm disabled:opacity-60">
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={15} className="animate-spin" />
                  {authPhase === "redirect" ? "Redirecting to dashboard…" : "Signing in…"}
                </span>
              ) : "Log in"}
            </button>
            {busy && (
              <p className="text-[11px] fp-text-faint mt-2 text-center fp-mono uppercase tracking-wide">
                {authPhase === "redirect" ? "Credentials verified · opening dashboard" : "Verifying credentials"}
              </p>
            )}
          </form>
          <p className="fp-text-faint text-xs text-center mt-4">
            New here? <Link href={`/p/${panel.subdomain}/signup`} className="fp-violet">Create account</Link>
          </p>
        </div>
      </main>

      {services.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {landingStats.map((s) => (
              <div key={s.label} className="fp-panel border fp-line rounded-2xl p-4 text-center">
                <p className="fp-display text-2xl fp-gold">{s.value}</p>
                <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {services.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t fp-line-soft">
          <h2 className="fp-display text-2xl mb-6 text-center">Services for every platform</h2>
          <div className="mb-6 flex justify-center">{PlatformTabs}</div>
          <div className="max-w-2xl mx-auto">{ServiceList}</div>
        </section>
      )}

      {/* How it works — default section on every panel */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t fp-line-soft">
        <h2 className="fp-display text-2xl md:text-3xl text-center mb-2">How it works</h2>
        <p className="fp-text-dim text-sm text-center mb-10 max-w-xl mx-auto">From sign-up to real growth in four simple steps.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { n: "1", icon: UserPlus, t: "Create an account", d: `Sign up on ${panel.name} in seconds — just an email.` },
            { n: "2", icon: Wallet, t: "Add funds", d: "Top up your wallet with the payment methods this panel supports." },
            { n: "3", icon: Search, t: "Pick a service", d: "Choose a platform and service, paste your link, set a quantity." },
            { n: "4", icon: TrendingUp, t: "Watch it grow", d: "Delivery starts fast and runs automatically until it's complete." },
          ].map((s) => (
            <div key={s.n} className="fp-panel border fp-line rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="w-10 h-10 rounded-xl fp-violet-soft-bg fp-violet flex items-center justify-center"><s.icon size={18} /></span>
                <span className="fp-mono text-xs fp-text-faint">0{s.n}</span>
              </div>
              <p className="text-sm font-medium mb-1">{s.t}</p>
              <p className="fp-text-dim text-sm leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

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

      {/* Secure payments — trust strip (only methods the owner actually connected) */}
      {paymentMethods.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 border-t fp-line-soft">
          <p className="fp-text-faint text-xs fp-mono uppercase tracking-[0.14em] text-center mb-5 flex items-center justify-center gap-1.5">
            <ShieldCheck size={13} /> Secure payments
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {paymentMethods.map((m) => (
              <span key={m.id} className="fp-panel-raised border fp-line-soft rounded-lg px-3.5 py-2 text-xs fp-text-dim flex items-center gap-1.5">
                <CreditCard size={13} className="fp-text-faint" /> {m.label}
              </span>
            ))}
          </div>
        </section>
      )}

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
