"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Circle, CheckCircle2, Clock, X, FileText, Lock, AlertTriangle, Wrench, History,
  Image as ImageIcon, Type, Globe, RefreshCw, Wifi, Gauge, Sliders, Tag,
  ChevronDown, ShieldCheck, ListOrdered, Users, CreditCard, KeyRound, Bell,
  MessageSquare, Bot, Plus, Trash2, Search, Download, ExternalLink, Wallet, Mail, LucideIcon,
} from "lucide-react";
import { getPlan, setPlan, type PlanInfo } from "@/src/lib/actions/plan";
import { getAutomatorPricing, setAutomatorPricing, type AutomatorPricingInfo } from "@/src/lib/actions/automator-pricing";
import { getWelcomeSettings, setWelcomeSettings, type WelcomeInfo } from "@/src/lib/actions/welcome";
import { sendWelcomeToCustomers } from "@/src/lib/actions/admin-tickets";
import { getBinanceReview, type BinanceReview } from "@/src/lib/actions/binance-admin";
import {
  listVirtualModerators, getModeratorPlanInfo, createVirtualModerator,
  requestTelegramCreation, getModeratorProvisioning, cancelTelegramProvisioning,
  type VirtualModeratorRow, type ModeratorPlanInfo,
} from "@/src/lib/actions/moderator";
import { VIRTUAL_MODERATOR_ENABLED } from "@/src/lib/moderator/plan";
import {
  Card, StatCard, FloorLedger, StatusBadge, StatusDropdown, Toggle, Pill,
} from "@/src/components/ui";
import {
  PANEL_STATUSES, categoriesData, PanelStatus,
} from "@/src/data/constants";
import { Panel, CustomerRow } from "@/src/types";
import type { ProviderRow, ProviderStatus, MarkupKind, OrderStatus } from "@/src/types/db";
import type { ProviderServiceDTO } from "@/src/lib/providers";
import {
  listProviders, createProvider, testProviderConnection,
  fetchProviderBalance, deleteProvider, updateProvider,
} from "@/src/lib/actions/providers";
import {
  listCatalog, fetchImportableServices, importServices,
  syncProviderServices, setServiceStatus, updateService, deleteService,
  recategorizeServices, bulkSetServiceStatus, bulkDeleteServices, bulkSetMarkup,
  deleteCategory, setPanelPlatformIcon,
  type ServiceVM, type CatalogPlatform,
} from "@/src/lib/actions/services";
import {
  listPanelCustomers, adjustCustomerBalance, setCustomerStatus,
  getCustomerManageDetails,
  type PanelCustomerVM,
} from "@/src/lib/actions/customers";
import {
  getPaymentsMeta, connectGateway, disconnectGateway, setPanelCurrency,
  listCustomerDeposits, commitPendingPayment, cancelPendingPayment,
  type PaymentsMeta, type OwnerDepositVM,
} from "@/src/lib/actions/payments";
import { getPanelBranding, updatePanelBranding, getPanelStatusHistory, type LandingSection, type PanelStatusEvent } from "@/src/lib/actions/panels";
import {
  listPanelOrdersPage, getPanelOverview, getPanelCurrency,
  resendOrder, requestRefill, requestCancel, markOrderCompleted, refundOrder,
  cancelAndRefundOrder, bulkCancelAndRefund, bulkResendOrders, refreshProviderBalancesAndRetryHeldOrders,
  type AdminOrderVM, type PanelOverview,
} from "@/src/lib/actions/admin-orders";
import { syncOrdersNow } from "@/src/lib/actions/orders";
import {
  getDomainInfo, setCustomDomain, removeCustomDomain, type DomainInfo,
} from "@/src/lib/actions/custom-domain";
import {
  getPanelCustomerApiSummary, setPanelCustomerApiEnabled, revokeCustomerApiKey,
} from "@/src/lib/actions/customer-api";
import { PANEL_ROOT_DOMAIN, panelStorefrontPath } from "@/src/lib/config";
import { THEMES } from "@/src/data/themes";
import { DesignStudio } from "./DesignStudio";
import { SupportInbox } from "./SupportInbox";
import { computeSellRate, formatMoney } from "@/src/lib/money";
import { PlatformGlyph } from "@/src/components/customer/PlatformIcons";

/* =========================================================
   PANEL ADMIN — TAB COMPONENTS
   Each tab is a focused, independently editable component.
   Shared state (status, expanded order, selected customer)
   lives in the PanelAdmin shell and is passed in as props.
   ========================================================= */

function getAdminCacheKey(panelId: string, section: string) {
  return `innvil-admin:${panelId}:${section}`;
}

function readAdminCache<T>(panelId: string, section: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const key = getAdminCacheKey(panelId, section);
    const raw = window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeAdminCache<T>(panelId: string, section: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    const key = getAdminCacheKey(panelId, section);
    const payload = JSON.stringify(value);
    window.sessionStorage.setItem(key, payload);
    window.localStorage.setItem(key, payload);
  } catch {
    // ignore storage failures
  }
}

const ORDER_STATUS_TONE: Record<string, "safe" | "gold" | "violet" | "muted"> = {
  completed: "safe",
  processing: "gold",
  in_progress: "gold",
  pending: "violet",
  partial: "gold",
  canceled: "muted",
  failed: "muted",
  refunded: "muted",
  duplicate: "violet",
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  completed: "Completed", processing: "Processing", in_progress: "In progress",
  pending: "Pending", partial: "Partial", canceled: "Canceled",
  failed: "Failed", refunded: "Refunded", duplicate: "Duplicate",
};
function OrderStatusPill({ status }: { status: OrderStatus }) {
  return <Pill tone={ORDER_STATUS_TONE[status] ?? "muted"}>{ORDER_STATUS_LABEL[status] ?? status}</Pill>;
}

/** Honest placeholder for admin sections not yet wired to real persistence. */
function ComingSoon({ title, icon, children }: { title: string; icon: LucideIcon; children?: React.ReactNode }) {
  return (
    <Card title={title} icon={icon} right={<span className="text-xs fp-gold-soft-bg fp-gold px-2.5 py-1 rounded-full">Coming soon</span>}>
      <p className="fp-text-dim text-sm leading-relaxed">{children}</p>
    </Card>
  );
}

export function OverviewTab({ panel }: { panel: Panel }) {
  const realPanel = isUuid(panel.id);
  const [data, setData] = useState<PanelOverview | null>(() =>
    realPanel ? readAdminCache<PanelOverview>(panel.id, "overview") : null
  );
  const [loading, setLoading] = useState(realPanel);

  useEffect(() => {
    if (!realPanel) return;
    let alive = true;
    getPanelOverview(panel.id).then((d) => {
      if (!alive || !d) { setLoading(false); return; }
      setData(d);
      writeAdminCache(panel.id, "overview", d);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [panel.id, realPanel]);

  const fmt = (n: number) => formatMoney(n, data?.currency ?? "USD");

  if (!realPanel) {
    return (
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-6 text-center fp-text-dim text-sm">
        Save this panel to see live stats here.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Revenue today" value={data ? fmt(data.revenueToday) : "—"} tone="gold" />
        <StatCard label="Orders today" value={data ? String(data.ordersToday) : "—"} />
        <StatCard label="Pending orders" value={data ? String(data.pendingOrders) : "—"} />
        <StatCard label="Customers" value={data ? String(data.customers) : "—"} />
      </div>

      <Card title="Recent orders" icon={ListOrdered}>
        {loading && !data ? (
          <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
        ) : !data || data.recent.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">No orders yet. They&apos;ll appear here as customers order.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                <th className="py-2 font-normal">ID</th>
                <th className="py-2 font-normal">Service</th>
                <th className="py-2 font-normal">Customer</th>
                <th className="py-2 font-normal text-right">Charge</th>
                <th className="py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((o) => (
                <tr key={o.id} className="border-b fp-line-soft last:border-0">
                  <td className="py-2.5 fp-mono fp-text-dim">#{o.orderNo ?? o.shortId}</td>
                  <td className="py-2.5">{o.serviceName}{o.serviceNo != null && <span className="fp-text-faint"> · #{o.serviceNo}</span>}</td>
                  <td className="py-2.5 fp-text-dim">{o.customerUsername ?? o.customerEmail ?? "—"}</td>
                  <td className="py-2.5 text-right fp-mono">{fmt(o.charge)}</td>
                  <td className="py-2.5"><OrderStatusPill status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

const STATUS_DOT_COLOR: Record<string, string> = {
  live: "#6FCF97",
  inactive: "#C9A574",
  maintenance: "#8B7FFF",
  suspended: "#E5647D",
  draft: "#9497A3",
};

/** Real, human relative time from a timestamp (e.g. "just now", "2h ago", "3 days ago"). */
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day} days ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// Owners set draft / live / maintenance; inactive (automatic) + suspended
// (support-only) are shown locked. Live is always clickable — with no balance the
// server runs it in preview (Inactive) until funds are added.
const OWNER_SETTABLE: PanelStatus[] = ["draft", "live", "maintenance"];
const LOCKED_STATUS_NOTE = {
  inactive: "Applied automatically when a panel runs out of Innvil credit.",
  suspended: "Set by Innvil support only.",
} as const;

export function StatusTab({
  panelId,
  panelStatus,
  setPanelStatus,
  innvilBalance = 0,
}: {
  panelId: string;
  panelStatus: PanelStatus;
  setPanelStatus: (s: PanelStatus) => void;
  innvilBalance?: number;
}) {
  const currentStatusConfig = PANEL_STATUSES[panelStatus] || PANEL_STATUSES.live;
  const realPanel = isUuid(panelId);
  const funded = (innvilBalance ?? 0) > 0;
  const [history, setHistory] = useState<PanelStatusEvent[] | null>(null);

  const loadHistory = useCallback(() => {
    if (!realPanel) return;
    getPanelStatusHistory(panelId).then(setHistory).catch(() => setHistory([]));
  }, [panelId, realPanel]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Change status, then re-fetch once the new event has been written.
  const handleChange = (s: PanelStatus) => {
    setPanelStatus(s);
    window.setTimeout(loadHistory, 800);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <Card title="Panel Status" icon={Circle}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={panelStatus} />
            <span className="text-sm fp-text-dim">Current status</span>
          </div>
          <StatusDropdown
            currentStatus={panelStatus}
            onChange={handleChange}
            settable={OWNER_SETTABLE}
            lockedNote={LOCKED_STATUS_NOTE}
          />
        </div>
        <p className="text-sm fp-text-dim leading-relaxed">{currentStatusConfig.description}</p>
        {realPanel && !funded && (
          <div className="mt-4 p-3 rounded-lg fp-gold-soft-bg border border-[rgba(201,165,116,0.25)] flex items-start gap-2">
            <Clock size={12} className="fp-gold shrink-0 mt-0.5" />
            <p className="text-xs fp-gold leading-relaxed">
              No Innvil balance yet. You can set this panel <span className="fp-text">Live to preview</span> your storefront,
              but it runs in <span className="fp-text">Inactive</span> (browse-only) mode until you add funds (Billing → Add funds) to accept orders.
            </p>
          </div>
        )}
      </Card>

      {/* Status-specific cards */}
      <Card title="Live" icon={CheckCircle2} tone={panelStatus === "live" ? "safe" : "line"}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="fp-safe" />
            <span className="text-sm">Panel is fully operational</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="fp-safe" />
            <span className="text-sm">Customers can browse services</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="fp-safe" />
            <span className="text-sm">Customers can place orders</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="fp-safe" />
            <span className="text-sm">API endpoints are active</span>
          </div>
        </div>
      </Card>

      <Card title="Inactive Mode" icon={Clock} tone={panelStatus === "inactive" ? "gold" : "line"}>
        <div className="space-y-4">
          <p className="text-sm fp-text-dim leading-relaxed">
            The panel remains online and accessible. Customers can still visit, log in/register,
            view dashboard, view services, view order history, view tickets, view wallet balance,
            and add funds (if deposits enabled by you).
          </p>
          <div className="border-t border-b fp-line-soft py-4 space-y-3">
            <p className="text-xs fp-mono uppercase fp-text-faint tracking-wide">What customers CAN do:</p>
            {["Visit and browse the panel", "Log in and register", "View dashboard and order history",
              "View services and pricing", "View support tickets", "View wallet balance", "Add funds / deposits"].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle2 size={14} className="fp-safe" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <p className="text-xs fp-mono uppercase fp-text-faint tracking-wide">What customers CANNOT do:</p>
            {["Submit new orders", "Submit mass orders", "Use order-submission API endpoints",
              "Request provider-based refill/cancel actions"].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <X size={14} className="text-red-400" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
          <div className="fp-gold-soft-bg border border-[rgba(201,165,116,0.2)] rounded-xl p-4">
            <p className="text-sm fp-gold font-medium">When to use Inactive Mode</p>
            <p className="text-xs fp-text-dim mt-1 leading-relaxed">
              Perfect when your Innvil balance is low but you want to keep your panel visible
              to customers. They can see your services, add funds, and orders will resume automatically
              once you top up.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Draft" icon={FileText}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="fp-text-dim" />
            <span className="text-sm fp-text-dim">Panel is being set up</span>
          </div>
          <div className="flex items-center gap-2">
            <X size={14} className="text-red-400" />
            <span className="text-sm fp-text-dim">Not visible to customers</span>
          </div>
          <div className="flex items-center gap-2">
            <X size={14} className="text-red-400" />
            <span className="text-sm fp-text-dim">Orders disabled</span>
          </div>
        </div>
      </Card>

      <Card title="Suspended" icon={Lock}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" />
            <span className="text-sm">Panel is offline</span>
          </div>
          <div className="flex items-center gap-2">
            <X size={14} className="text-red-400" />
            <span className="text-sm">Not accessible to customers</span>
          </div>
          <div className="flex items-center gap-2">
            <X size={14} className="text-red-400" />
            <span className="text-sm">All orders paused</span>
          </div>
        </div>
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400 leading-relaxed">
            Suspended panels require contact with Innvil support for restoration.
            This status is typically applied for terms of service violations.
          </p>
        </div>
      </Card>

      <Card title="Maintenance" icon={Wrench} tone="violet">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Wrench size={14} className="fp-violet" />
            <span className="text-sm">Panel temporarily offline</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="fp-safe" />
            <span className="text-sm">Automatically returns to previous status</span>
          </div>
          <div className="flex items-center gap-2">
            <X size={14} className="text-red-400" />
            <span className="text-sm">Customers see maintenance notice</span>
          </div>
        </div>
      </Card>

      <Card title="Status History" icon={History}>
        {!realPanel ? (
          <p className="fp-text-faint text-sm py-2">History appears once this panel is saved.</p>
        ) : history === null ? (
          <p className="fp-text-faint text-sm py-2">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="fp-text-faint text-sm py-2">No status changes recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-sm gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_DOT_COLOR[h.status] ?? "#9497A3" }} />
                  <span className="truncate">
                    {h.label}
                    {h.note && <span className="fp-text-faint"> · {h.note}</span>}
                  </span>
                </div>
                <span className="fp-text-faint text-xs fp-mono shrink-0" title={new Date(h.at).toLocaleString()}>
                  {relTime(h.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function BrandingTab({ panel }: { panel: Panel }) {
  const realPanel = isUuid(panel.id);
  const [name, setName] = useState(panel.name);
  const [theme, setTheme] = useState("obsidian-gold");
  const [logoUrl, setLogoUrl] = useState("");
  const [accent, setAccent] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [favicon, setFavicon] = useState("");
  const [sections, setSections] = useState<LandingSection[]>([]);
  const [platformFocus, setPlatformFocus] = useState<string | null>(null);
  const [studioFull, setStudioFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!realPanel) return;
    getPanelBranding(panel.id).then((b) => {
      if (!b) return;
      setName(b.name);
      setTheme(b.theme || "obsidian-gold");
      setLogoUrl(b.logoUrl);
      setAccent(b.accent);
      setHeadline(b.headline);
      setDescription(b.description);
      setFavicon(b.favicon);
      setSections(b.sections);
      setPlatformFocus(b.platformFocus);
    });
  }, [panel.id, realPanel]);

  const save = async () => {
    if (!realPanel) { setMsg({ text: "Save this panel first.", error: true }); return; }
    setBusy(true); setMsg(null);
    const res = await updatePanelBranding(panel.id, { name, theme, logoUrl, accent, headline, description, favicon, sections, platformFocus });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Branding saved — reload your live panel to see it." });
  };

  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 outline-none focus:fp-gold-border";

  return (
    <div className="space-y-4">
      {studioFull && realPanel && (
        <DesignStudio
          panel={{ id: panel.id, name, subdomain: panel.subdomain }}
          initial={{ name, theme, logoUrl, accent, headline, description, favicon, sections, platformFocus }}
          onClose={() => setStudioFull(false)}
          onSaved={(vv) => {
            setName(vv.name); setTheme(vv.theme); setLogoUrl(vv.logoUrl);
            setAccent(vv.accent); setHeadline(vv.headline); setDescription(vv.description);
            setFavicon(vv.favicon); setSections(vv.sections); setPlatformFocus(vv.platformFocus);
            setMsg({ text: "Design saved — reload your live panel to see it." });
          }}
        />
      )}
      {msg && (
        <div className={`text-sm px-4 py-2.5 rounded-lg border flex items-center justify-between gap-3 ${msg.error ? "bg-red-500/10 border-red-500/20 text-red-400" : "fp-safe-soft-bg fp-safe-border fp-safe"}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Logo & identity" icon={ImageIcon}>
          <div className="border border-dashed fp-line rounded-xl h-28 flex items-center justify-center fp-text-faint text-sm mb-4 overflow-hidden">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo preview" className="max-h-full max-w-full object-contain" />
            ) : (
              "Paste a logo URL below"
            )}
          </div>
          <label className="fp-text-dim text-xs fp-mono uppercase">Logo URL</label>
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" className={`${inputCls} fp-mono`} />
          <p className="fp-text-faint text-[11px] mt-1.5">Direct image URL (PNG/SVG). File upload is coming soon.</p>

          <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">Panel display name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Card>

        <Card title="Colors & type" icon={Type}>
          <p className="fp-text-dim text-xs fp-mono uppercase mb-2">Theme</p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`text-left rounded-lg border p-3 transition-colors ${theme === t.id ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised hover:fp-gold-border"}`}
              >
                <div className="flex gap-1.5 mb-2">
                  <span className="w-4 h-4 rounded-full border border-black/20" style={{ background: t.a }} />
                  <span className="w-4 h-4 rounded-full border border-black/20" style={{ background: t.b }} />
                </div>
                <p className="text-xs">{t.label}</p>
              </button>
            ))}
          </div>

          <button onClick={() => setStudioFull(true)} disabled={!realPanel} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
            <Gauge size={14} /> Open full Design Studio
          </button>
          <p className="fp-text-faint text-[11px] mt-2">Full-screen live editor — custom accent, landing headline &amp; description, real-time preview, and the premium Design Shop.</p>
        </Card>
      </div>

      <button onClick={save} disabled={busy} className="fp-btn-primary font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50">
        {busy ? "Saving…" : "Save branding"}
      </button>
    </div>
  );
}

function DnsRecordRow({ type, name, value, note }: { type: string; name: string; value: string; note?: string }) {
  return (
    <div className="py-1.5 border-b fp-line-soft last:border-0">
      <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[80px_120px_1fr] gap-2 items-center text-xs">
        <span className="fp-mono fp-gold">{type}</span>
        <span className="fp-mono fp-text-dim truncate hidden sm:block">{name}</span>
        <span className="fp-mono fp-text truncate">{value}</span>
      </div>
      {note && <p className="text-[11px] fp-text-faint mt-1.5 sm:ml-[200px]">{note}</p>}
    </div>
  );
}

export function DomainTab({ panel }: { panel: Panel }) {
  const realPanel = isUuid(panel.id);
  const [info, setInfo] = useState<DomainInfo | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!realPanel) return;
    try {
      const i = await getDomainInfo(panel.id);
      setInfo(i);
      if (i?.customDomain) setDomain(i.customDomain);
    } catch {
      setMsg({ text: "Could not load current domain status.", error: true });
    }
  }, [panel.id, realPanel]);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await setCustomDomain(panel.id, domain);
      if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
      setInfo(res.data);
      setMsg({ text: "Domain saved. Add the DNS record below, then re-check." });
    } catch {
      setMsg({ text: "Could not save the custom domain right now.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await removeCustomDomain(panel.id);
      if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
      setDomain("");
      setInfo((p) => p ? { ...p, customDomain: null, verified: false, misconfigured: false, verification: [], recommended: [] } : p);
      setMsg({ text: "Custom domain disconnected." });
      await load();
    } catch {
      setMsg({ text: "Could not disconnect the domain right now.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    if (busy || rechecking) return;
    setRechecking(true);
    try {
      await load();
    } finally {
      setRechecking(false);
    }
  };

  const connected = !!info?.customDomain;
  const live = connected && !!info?.verified && !info?.misconfigured;
  const statusPill = !connected ? null
    : info!.misconfigured ? <Pill tone="danger" icon={AlertTriangle}>DNS not detected</Pill>
    : live ? <Pill tone="safe" icon={CheckCircle2}>Live &amp; secured</Pill>
    : <Pill tone="gold" icon={Clock}>Pending DNS</Pill>;

  return (
    <Card title="Domain" icon={Globe} right={statusPill ?? undefined}>
      {/* Included subdomain — always live */}
      <div className="flex items-center justify-between fp-panel-raised border fp-line-soft rounded-xl p-4 mb-5">
        <div className="min-w-0">
          <p className="text-sm fp-mono truncate">{panel.subdomain}.{PANEL_ROOT_DOMAIN}</p>
          <p className="fp-text-faint text-xs mt-0.5">Included subdomain — live now</p>
        </div>
        <a href={panelStorefrontPath(panel.subdomain, panel.domain)} target="_blank" rel="noopener noreferrer" className="fp-panel border fp-line-soft text-xs px-3 py-1.5 rounded-lg fp-text-dim hover:fp-gold-border flex items-center gap-1 shrink-0">
          <ExternalLink size={12} /> Visit
        </a>
      </div>

      {!realPanel ? (
        <p className="fp-text-faint text-sm">Save this panel first to connect a custom domain.</p>
      ) : (
        <>
          <label className="fp-text-dim text-xs fp-mono uppercase">Custom domain</label>
          <div className="flex gap-2 mt-2">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="panel.yourbrand.com"
              className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm fp-mono outline-none focus:fp-gold-border"
            />
            {connected ? (
              <>
                <button onClick={recheck} disabled={busy || rechecking} className="fp-panel-raised border fp-line-soft px-4 rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-50">
                  <RefreshCw size={13} className={rechecking ? "animate-spin" : ""} /> {rechecking ? "Checking..." : "Re-check"}
                </button>
                <button onClick={disconnect} disabled={busy} className="border border-red-500/30 text-red-400 px-4 rounded-lg text-sm disabled:opacity-50">Disconnect</button>
              </>
            ) : (
              <button onClick={connect} disabled={busy || !domain.trim()} className="fp-btn-primary text-sm font-semibold px-4 rounded-lg disabled:opacity-50">
                {busy ? "…" : "Connect"}
              </button>
            )}
          </div>

          {msg && <p className={`text-xs mt-2 flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>}

          {connected && !live && (
            <div className="mt-5 fp-panel-raised border fp-line-soft rounded-xl p-4">
              <p className="fp-text-faint text-xs fp-mono uppercase mb-1">DNS setup</p>
              <p className="fp-text-dim text-xs mb-3">
                Add one of the recommended records below. For apex/root domains, you can use Vercel&apos;s A record (76.76.21.21) or use ALIAS/ANAME/CNAME flattening if your DNS provider requires it.
              </p>
              <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[80px_120px_1fr] gap-2 fp-text-faint text-[10px] fp-mono uppercase pb-1 border-b fp-line-soft">
                <span>Type</span><span className="hidden sm:block">Name</span><span>Value</span>
              </div>
              {info!.recommended.map((r, i) => <DnsRecordRow key={`rec-${i}`} type={r.type} name={r.name} value={r.value} note={r.note} />)}
              {info!.verification.map((v, i) => <DnsRecordRow key={i} type={v.type} name={v.domain} value={v.value} />)}

              <p className="fp-text-faint text-xs mt-3">After adding the record, DNS can take a few minutes to a few hours. Click Re-check to refresh.</p>
              {!info!.vercelManaged && (
                <p className="fp-gold text-[11px] mt-3 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> Automatic setup isn&apos;t configured (VERCEL_API_TOKEN). Also add <span className="fp-mono">{info!.customDomain}</span> to the Vercel project so it routes and gets an SSL cert.</p>
              )}
            </div>
          )}

          {connected && live && (
            <div className="mt-5 fp-panel-raised border fp-line-soft rounded-xl p-4">
              <p className="fp-safe text-xs flex items-center gap-1.5"><CheckCircle2 size={12} /> Verified — your panel is live on {info!.customDomain}.</p>
            </div>
          )}

          {!connected && (
            <p className="fp-text-faint text-xs mt-3 leading-relaxed">
              Point your own domain at this panel. Your customers see your brand end-to-end — the included
              {" "}{PANEL_ROOT_DOMAIN} subdomain keeps working too.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

type RowState = { busy?: boolean; msg?: string; error?: boolean };
const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Provider (API) balance thresholds — a provider at/under LOW needs a top-up soon.
const LOW_BALANCE_THRESHOLD = 10; // in the provider's own currency
const BALANCE_STALE_MS = 10 * 60 * 1000; // auto-refresh balances older than this
function balanceIsStale(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > BALANCE_STALE_MS;
}
function shortAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ProvidersTab({ panelId }: { panelId: string }) {
  const realPanel = isUuid(panelId);
  const [providers, setProviders] = useState<ProviderRow[] | null>(() =>
    realPanel ? readAdminCache<ProviderRow[]>(panelId, "providers") : []
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", apiUrl: "", apiKey: "", currency: "USD" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    apiUrl: "",
    apiKey: "",
    currency: "USD",
    status: "active" as ProviderStatus,
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [autoSyncing, setAutoSyncing] = useState(false);
  const providersRef = useRef<ProviderRow[] | null>(providers);
  const autoFetchedRef = useRef(false);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  const refresh = useCallback(async () => {
    if (!realPanel) {
      setProviders([]);
      writeAdminCache(panelId, "providers", []);
      return;
    }

    const cached = providersRef.current ?? readAdminCache<ProviderRow[]>(panelId, "providers");
    if (cached) setProviders(cached);

    const next = await listProviders(panelId);
    setProviders(next);
    writeAdminCache(panelId, "providers", next);
  }, [panelId, realPanel]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh stale/missing provider balances once on load, so the owner can
  // immediately see which API needs a top-up without clicking each row.
  useEffect(() => {
    if (!realPanel || autoFetchedRef.current) return;
    if (!providers || providers.length === 0) return;
    const stale = providers.filter((p) => p.balance == null || balanceIsStale(p.last_balance_sync));
    if (stale.length === 0) { autoFetchedRef.current = true; return; }
    autoFetchedRef.current = true;
    setAutoSyncing(true);
    Promise.all(stale.map((p) => fetchProviderBalance(p.id).catch(() => null)))
      .then(() => refresh())
      .finally(() => setAutoSyncing(false));
  }, [providers, realPanel, refresh]);

  const setRow = (id: string, s: RowState) => setRows((prev) => ({ ...prev, [id]: s }));

  const submit = async () => {
    setFormError(null);
    if (!form.name.trim() || !form.apiUrl.trim()) {
      setFormError("Name and API URL are required.");
      return;
    }
    setSaving(true);
    const res = await createProvider({
      panelId,
      name: form.name.trim(),
      apiUrl: form.apiUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      currency: form.currency.trim() || "USD",
    });
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    setForm({ name: "", apiUrl: "", apiKey: "", currency: "USD" });
    setShowForm(false);
    refresh();
  };

  const test = async (id: string) => {
    setRow(id, { busy: true });
    const res = await testProviderConnection(id);
    setRow(id, res.ok
      ? { msg: `Connected · balance ${res.data.balance} ${res.data.currency}` }
      : { msg: res.error, error: true });
  };

  const fetchBal = async (id: string) => {
    setRow(id, { busy: true });
    const res = await fetchProviderBalance(id);
    setRow(id, res.ok
      ? { msg: `Balance updated: ${res.data.balance} ${res.data.currency}` }
      : { msg: res.error, error: true });
    if (res.ok) refresh();
  };

  const remove = async (id: string) => {
    setRow(id, { busy: true });
    const res = await deleteProvider(id);
    if (res.ok) refresh();
    else setRow(id, { msg: res.error, error: true });
  };

  const startEdit = (p: ProviderRow) => {
    setShowForm(false);
    setFormError(null);
    setEditError(null);
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      apiUrl: p.api_url,
      apiKey: "",
      currency: p.currency || "USD",
      status: p.status,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setEditError(null);
    if (!editForm.name.trim() || !editForm.apiUrl.trim()) {
      setEditError("Name and API URL are required.");
      return;
    }
    setUpdating(true);
    const res = await updateProvider(editingId, {
      name: editForm.name.trim(),
      apiUrl: editForm.apiUrl.trim(),
      apiKey: editForm.apiKey.trim() || undefined,
      currency: editForm.currency.trim() || "USD",
      status: editForm.status,
    });
    setUpdating(false);
    if (!res.ok) {
      setEditError(res.error);
      return;
    }
    setRow(editingId, { msg: "Provider updated." });
    setEditingId(null);
    setEditForm({ name: "", apiUrl: "", apiKey: "", currency: "USD", status: "active" });
    refresh();
  };

  return (
    <div className="space-y-4">
      {!realPanel && (
        <Card tone="gold">
          <p className="text-sm fp-gold flex items-center gap-2">
            <AlertTriangle size={15} /> Save this panel first
          </p>
          <p className="text-xs fp-text-dim mt-1">
            Providers attach to a real panel. Create a panel from “My Panels”, then open it here.
          </p>
        </Card>
      )}

      <Card
        title="Connected providers"
        icon={Wifi}
        right={
          <div className="flex items-center gap-3">
            {autoSyncing && <span className="text-[11px] fp-text-faint flex items-center gap-1.5"><RefreshCw size={11} className="animate-spin" /> Checking balances…</span>}
            <button
              onClick={() => { setShowForm((v) => !v); setFormError(null); }}
              disabled={!realPanel}
              className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={13} /> Add provider
            </button>
          </div>
        }
      >
        {showForm && (
          <div className="mb-5 p-4 rounded-xl fp-panel-raised border fp-line-soft space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Provider Alpha" name="ll-provider-name" autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5`} />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Currency</label>
                <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="USD" name="ll-provider-currency" autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5`} />
              </div>
            </div>
            <div>
              <label className="fp-text-dim text-xs fp-mono uppercase">API URL</label>
              <input value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} placeholder="https://provider.com/api/v2" type="url" inputMode="url" name="ll-provider-url" autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5 fp-mono`} />
            </div>
            <div>
              <label className="fp-text-dim text-xs fp-mono uppercase">API key</label>
              <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} type="password" placeholder="Stored encrypted — never shown again" name="ll-provider-key" autoComplete="new-password" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5 fp-mono`} />
            </div>
            {formError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {formError}</p>
            )}
            <div className="flex gap-2">
              <button onClick={submit} disabled={saving} className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                {saving ? "Saving…" : "Save provider"}
              </button>
              <button onClick={() => setShowForm(false)} className="fp-panel border fp-line-soft text-xs px-4 py-2 rounded-lg fp-text-dim">
                Cancel
              </button>
            </div>
          </div>
        )}

        {editingId && (
          <div className="mb-5 p-4 rounded-xl fp-panel-raised border fp-line-soft space-y-3">
            <p className="text-xs fp-text-dim fp-mono uppercase">Edit provider API info</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Provider Alpha" name="ll-provider-edit-name" autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5`} />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Currency</label>
                <input value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })} placeholder="USD" name="ll-provider-edit-currency" autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5`} />
              </div>
            </div>
            <div>
              <label className="fp-text-dim text-xs fp-mono uppercase">API URL</label>
              <input value={editForm.apiUrl} onChange={(e) => setEditForm({ ...editForm, apiUrl: e.target.value })} placeholder="https://provider.com/api/v2" type="url" inputMode="url" name="ll-provider-edit-url" autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5 fp-mono`} />
            </div>
            <div>
              <label className="fp-text-dim text-xs fp-mono uppercase">API key</label>
              <input value={editForm.apiKey} onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })} type="password" placeholder="Leave blank to keep existing key" name="ll-provider-edit-key" autoComplete="new-password" data-lpignore="true" data-1p-ignore data-form-type="other" className={`${inputCls} mt-1.5 fp-mono`} />
            </div>
            <div>
              <label className="fp-text-dim text-xs fp-mono uppercase">Status</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as ProviderStatus })} className={`${inputCls} mt-1.5`}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
            {editError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {editError}</p>
            )}
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={updating} className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                {updating ? "Updating…" : "Update provider"}
              </button>
              <button onClick={() => { setEditingId(null); setEditError(null); }} className="fp-panel border fp-line-soft text-xs px-4 py-2 rounded-lg fp-text-dim">
                Cancel
              </button>
            </div>
          </div>
        )}

        {providers === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading providers…</p>
        ) : providers.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">
            {realPanel ? "No providers connected yet. Add your SMM provider to import services." : "—"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                  <th className="py-2 font-normal">Provider</th>
                  <th className="py-2 font-normal">Status</th>
                  <th className="py-2 font-normal">Balance</th>
                  <th className="py-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  const st = rows[p.id] ?? {};
                  return (
                    <tr key={p.id} className="border-b fp-line-soft last:border-0 align-top">
                      <td className="py-3">
                        {p.name}
                        <p className="fp-text-faint text-[10px] fp-mono truncate max-w-[220px]">{p.api_url}</p>
                        {st.msg && (
                          <p className={`text-[11px] mt-1 ${st.error ? "text-red-400" : "fp-safe"}`}>{st.msg}</p>
                        )}
                      </td>
                      <td className="py-3">
                        <Pill tone={p.status === "active" ? "safe" : "muted"}>{p.status}</Pill>
                      </td>
                      <td className="py-3">
                        {p.balance == null ? (
                          <span className="fp-text-faint text-xs">—</span>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`fp-mono text-sm font-medium ${p.balance <= 0 ? "text-red-400" : p.balance < LOW_BALANCE_THRESHOLD ? "fp-gold" : "fp-text"}`}>
                              {p.balance} {p.currency}
                            </span>
                            {p.balance <= 0 ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> Top up</span>
                            ) : p.balance < LOW_BALANCE_THRESHOLD ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full fp-gold-soft-bg fp-gold">Low</span>
                            ) : null}
                          </div>
                        )}
                        <p className="fp-text-faint text-[10px] mt-0.5">balance · {shortAgo(p.last_balance_sync)}</p>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2 text-xs fp-text-dim flex-wrap items-center">
                          <button onClick={() => startEdit(p)} disabled={st.busy} className="hover:fp-text disabled:opacity-50">Edit</button>
                          <button onClick={() => test(p.id)} disabled={st.busy} className="hover:fp-text disabled:opacity-50">Test</button>
                          <button onClick={() => fetchBal(p.id)} disabled={st.busy} className="hover:fp-text disabled:opacity-50 flex items-center gap-1">
                            <RefreshCw size={11} /> Balance
                          </button>
                          <button onClick={() => remove(p.id)} disabled={st.busy} className="text-red-400 disabled:opacity-50 flex items-center gap-1">
                            <Trash2 size={11} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const fmtMoney = (n: number) =>
  `$${n.toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}`;

type EditForm = { name: string; description: string; markupKind: MarkupKind; markupValue: string };

export function ServicesTab({ panelId }: { panelId: string }) {
  const realPanel = isUuid(panelId);
  const [catalog, setCatalog] = useState<CatalogPlatform[] | null>(() =>
    realPanel ? readAdminCache<CatalogPlatform[]>(panelId, "services-catalog") : []
  );
  const [providers, setProviders] = useState<ProviderRow[]>(() =>
    realPanel ? readAdminCache<ProviderRow[]>(panelId, "services-providers") ?? [] : []
  );
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Accordion + inline edit
  const [openP, setOpenP] = useState<Set<string>>(new Set());
  const [openS, setOpenS] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditForm>({ name: "", description: "", markupKind: "percent", markupValue: "0" });

  // Bulk selection
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkMkOpen, setBulkMkOpen] = useState(false);
  const [bulkKind, setBulkKind] = useState<MarkupKind>("percent");
  const [bulkVal, setBulkVal] = useState("20");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<
    | null
    | {
        kind: "service" | "category" | "bulk";
        serviceId?: string;
        categoryId?: string | null;
        categoryName?: string;
        serviceIds?: string[];
        count: number;
      }
  >(null);

  // Import panel
  const [importOpen, setImportOpen] = useState(false);
  const [impProvider, setImpProvider] = useState("");
  const [provCatalog, setProvCatalog] = useState<ProviderServiceDTO[] | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [markupKind, setMarkupKind] = useState<MarkupKind>("percent");
  const [markupValue, setMarkupValue] = useState("20");
  // Optional per-service markup override value (keyed by provider_service_id).
  // Blank = use the global markup. Uses the same markup type as the global.
  const [perMarkup, setPerMarkup] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const catalogRef = useRef<CatalogPlatform[] | null>(catalog);
  const providersRef = useRef<ProviderRow[]>(providers);
  // Remember the selection + per-service markup PER provider so switching the
  // import provider doesn't discard what was already chosen for another one.
  const selStoreRef = useRef<Record<string, { selected: Set<string>; perMarkup: Record<string, string> }>>({});
  const impProviderRef = useRef("");
  const selectedRef = useRef<Set<string>>(selected);
  const perMarkupRef = useRef<Record<string, string>>(perMarkup);

  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  useEffect(() => { providersRef.current = providers; }, [providers]);
  useEffect(() => { impProviderRef.current = impProvider; }, [impProvider]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { perMarkupRef.current = perMarkup; }, [perMarkup]);

  const refresh = useCallback(async () => {
    if (!realPanel) {
      setCatalog([]);
      writeAdminCache(panelId, "services-catalog", []);
      return;
    }

    const cached = catalogRef.current ?? readAdminCache<CatalogPlatform[]>(panelId, "services-catalog");
    if (cached) setCatalog(cached);

    const next = await listCatalog(panelId);
    setCatalog(next);
    writeAdminCache(panelId, "services-catalog", next);
  }, [panelId, realPanel]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!realPanel) return;
    const cached = providersRef.current.length > 0 ? providersRef.current : readAdminCache<ProviderRow[]>(panelId, "services-providers") ?? [];
    if (cached.length > 0) setProviders(cached);
    listProviders(panelId).then((next) => {
      setProviders(next);
      writeAdminCache(panelId, "services-providers", next);
    });
  }, [panelId, realPanel]);

  const loadCatalog = async (provId: string) => {
    // Stash the current provider's selection before switching away from it…
    const prev = impProviderRef.current;
    if (prev && prev !== provId) {
      selStoreRef.current[prev] = { selected: new Set(selectedRef.current), perMarkup: { ...perMarkupRef.current } };
    }
    setImpProvider(provId);
    // …and restore whatever was previously chosen for the provider we're loading.
    const saved = selStoreRef.current[provId];
    setSelected(saved ? new Set(saved.selected) : new Set());
    setPerMarkup(saved ? { ...saved.perMarkup } : {});
    setProvCatalog(null);
    const res = await fetchImportableServices(provId);
    if (!res.ok) { setMsg({ text: res.error, error: true }); setProvCatalog([]); return; }
    setProvCatalog(res.data.services);
    setImportedIds(new Set(res.data.importedIds.map(String)));
  };

  const openImport = () => {
    const provId = impProvider || providers[0]?.id;
    if (!provId) { setMsg({ text: "Connect a provider first (Providers & API tab).", error: true }); return; }
    setMsg(null);
    setSearch("");
    setImportOpen(true);
    loadCatalog(provId);
  };

  const filtered = (provCatalog ?? []).filter((s) =>
    !search.trim() || `${s.name} ${s.category} ${s.service}`.toLowerCase().includes(search.toLowerCase())
  );

  const catalogFiltered = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalog ?? [];
    const isNumeric = /^\d+$/.test(q);
    return (catalog ?? [])
      .map((p) => {
        const subs = p.subs
          .map((sub) => {
            const services = sub.services.filter((s) => {
              const localIdText = s.localId != null ? String(s.localId) : "";
              const providerIdText = String(s.providerServiceId ?? "");
              if (isNumeric) {
                return localIdText.includes(q) || providerIdText.includes(q);
              }
              const hay = [
                s.name,
                sub.name,
                p.name,
                localIdText,
                providerIdText,
              ]
                .join(" ")
                .toLowerCase();
              return hay.includes(q);
            });
            return { ...sub, services, count: services.length };
          })
          .filter((sub) => sub.services.length > 0);
        const count = subs.reduce((n, sub) => n + sub.services.length, 0);
        return { ...p, subs, count };
      })
      .filter((p) => p.count > 0);
  }, [catalog, catalogSearch]);
  const selectableIds = filtered.filter((s) => !importedIds.has(String(s.service))).map((s) => String(s.service));
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleSelectAll = () =>
    setSelected((prev) => {
      if (allSelected) { const n = new Set(prev); selectableIds.forEach((id) => n.delete(id)); return n; }
      return new Set([...prev, ...selectableIds]);
    });

  const doImport = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setMsg(null);
    // Build per-service overrides for any selected service with a custom value.
    const markupOverrides: Record<string, { kind: MarkupKind; value: number }> = {};
    for (const id of selected) {
      const raw = perMarkup[id];
      if (raw !== undefined && raw !== "" && !Number.isNaN(Number(raw))) {
        markupOverrides[id] = { kind: markupKind, value: Number(raw) };
      }
    }
    const res = await importServices(impProvider, {
      providerServiceIds: [...selected],
      markupKind,
      markupValue: Number(markupValue) || 0,
      ...(Object.keys(markupOverrides).length ? { markupOverrides } : {}),
    });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Imported ${res.data.imported} service(s)${res.data.skipped ? `, skipped ${res.data.skipped} already imported` : ""}.` });
    // Clear this provider's remembered selection now that it's imported.
    delete selStoreRef.current[impProvider];
    setSelected(new Set());
    setPerMarkup({});
    setImportOpen(false);
    refresh();
  };

  const doSync = async () => {
    const provId = impProvider || providers[0]?.id;
    if (!provId) return;
    setBusy(true);
    setMsg(null);
    const res = await syncProviderServices(provId);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Synced: ${res.data.updated} updated, ${res.data.disabled} disabled.` });
    refresh();
  };

  const doReorganize = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await recategorizeServices(panelId);
      if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
      setMsg({ text: `Re-organized ${res.data.updated} service(s) into platform → type categories.` });
      refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Re-organize failed.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (svc: ServiceVM) => {
    await setServiceStatus(svc.id, svc.status === "active" ? "disabled" : "active");
    refresh();
  };

  const startEdit = (s: ServiceVM) => {
    setEditing(s.id);
    setEdit({ name: s.name, description: s.description ?? "", markupKind: s.markupKind, markupValue: String(s.markupValue) });
  };
  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    const res = await updateService(editing, {
      name: edit.name.trim(),
      description: edit.description.trim() || null,
      markupKind: edit.markupKind,
      markupValue: Number(edit.markupValue) || 0,
    });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setEditing(null);
    refresh();
  };
  const doDelete = async (s: ServiceVM) => {
    setConfirmDelete({ kind: "service", serviceId: s.id, categoryName: s.name, count: 1 });
  };

  const runDeleteService = async (serviceId: string) => {
    const res = await deleteService(serviceId);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    refresh();
  };

  // Delete a whole category (platform or sub) + every service in it. Falls back
  // to deleting by service ids for id-less groups (Uncategorized/legacy flat).
  const doDeleteCategory = async (id: string | null, name: string, serviceIds: string[]) => {
    setConfirmDelete({ kind: "category", categoryId: id, categoryName: name, serviceIds, count: serviceIds.length });
  };

  const runDeleteCategory = async (id: string | null, name: string, serviceIds: string[]) => {
    setBusy(true);
    const res = id ? await deleteCategory(id) : await bulkDeleteServices(serviceIds);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    const n = res.data && "services" in res.data ? res.data.services : res.data?.count ?? 0;
    setMsg({ text: `Deleted "${name}" (${n} service${n === 1 ? "" : "s"}).` });
    setSel(new Set());
    refresh();
  };

  // Per-platform custom logo (monochrome SVG path) editor.
  const [logoEdit, setLogoEdit] = useState<{ key: string; value: string } | null>(null);
  const saveLogo = async () => {
    if (!logoEdit) return;
    setBusy(true);
    const res = await setPanelPlatformIcon(panelId, logoEdit.key, logoEdit.value.trim() || null);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Logo ${logoEdit.value.trim() ? "updated" : "cleared"} for ${logoEdit.key}.` });
    setLogoEdit(null);
    refresh();
  };

  const togglePlatform = (k: string) => setOpenP((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleSubOpen = (k: string) => setOpenS((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Bulk selection handlers (on imported services; distinct from the import picker's toggleSel)
  const toggleRowSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSel(new Set());

  // Every service id across the whole catalog (regardless of which groups are
  // expanded) — powers a true "Select all" so bulk delete/disable can hit them all.
  const allServiceIds = useMemo(
    () => (catalog ?? []).flatMap((p) => p.subs.flatMap((s) => s.services.map((x) => x.id))),
    [catalog]
  );
  const catalogAllSelected = allServiceIds.length > 0 && allServiceIds.every((id) => sel.has(id));
  const toggleCatalogSelectAll = () => setSel(catalogAllSelected ? new Set() : new Set(allServiceIds));

  const runBulk = async (
    fn: () => Promise<{ ok: boolean; error?: string; data?: { count: number } }>,
    label: (n: number) => string
  ) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      if (!res.ok) { setMsg({ text: res.error ?? "Failed", error: true }); return; }
      setMsg({ text: label(res.data?.count ?? 0) });
      clearSel();
      setBulkMkOpen(false);
      refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Bulk action failed.", error: true });
    } finally {
      setBusy(false);
    }
  };
  const bulkEnable = () => runBulk(() => bulkSetServiceStatus([...sel], "active"), (n) => `Enabled ${n} service(s).`);
  const bulkDisable = () => runBulk(() => bulkSetServiceStatus([...sel], "disabled"), (n) => `Disabled ${n} service(s).`);
  const bulkDelete = () => {
    if (!sel.size) return;
    setConfirmDelete({ kind: "bulk", serviceIds: [...sel], count: sel.size });
  };
  const bulkMarkup = () => runBulk(() => bulkSetMarkup([...sel], bulkKind, Number(bulkVal) || 0), (n) => `Updated markup on ${n} service(s).`);

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;
    const action = confirmDelete;
    setConfirmDelete(null);
    if (action.kind === "service" && action.serviceId) {
      await runDeleteService(action.serviceId);
      return;
    }
    if (action.kind === "category") {
      await runDeleteCategory(action.categoryId ?? null, action.categoryName ?? "Category", action.serviceIds ?? []);
      return;
    }
    if (action.kind === "bulk") {
      await runBulk(() => bulkDeleteServices(action.serviceIds ?? []), (n) => `Deleted ${n} service(s).`);
    }
  };

  if (!realPanel) {
    return (
      <Card tone="gold">
        <p className="text-sm fp-gold flex items-center gap-2"><AlertTriangle size={15} /> Save this panel first</p>
        <p className="text-xs fp-text-dim mt-1">Services are imported into a real panel. Create a panel, then open it.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {confirmDelete && (
        <ConfirmActionModal
          title={confirmDelete.kind === "category" ? "Delete Category" : "Delete Services"}
          message={confirmDelete.kind === "service"
            ? `Delete "${confirmDelete.categoryName}"? This cannot be undone.`
            : confirmDelete.kind === "category"
              ? `Delete "${confirmDelete.categoryName}" and its ${confirmDelete.count} service(s)? This cannot be undone.`
              : `Delete ${confirmDelete.count} selected service(s)? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={confirmDeleteAction}
        />
      )}
      {msg && (
        <div className={`text-sm px-4 py-2.5 rounded-lg border flex items-center justify-between gap-3 ${msg.error ? "bg-red-500/10 border-red-500/20 text-red-400" : "fp-safe-soft-bg fp-safe-border fp-safe"}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {importOpen && (
        <Card
          title="Import from provider"
          icon={Download}
          right={<button onClick={() => setImportOpen(false)} className="fp-text-faint hover:fp-text"><X size={16} /></button>}
        >
          {providers.length > 1 && (
            <div className="mb-4">
              <label className="fp-text-dim text-xs fp-mono uppercase">Provider</label>
              <select value={impProvider} onChange={(e) => loadCatalog(e.target.value)} className="w-full mt-1.5 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border">
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="fp-text-dim text-xs fp-mono uppercase">Markup type</label>
              <select value={markupKind} onChange={(e) => setMarkupKind(e.target.value as MarkupKind)} className="w-full mt-1.5 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border">
                <option value="percent">Percent (+%)</option>
                <option value="multiplier">Multiplier (×)</option>
                <option value="fixed">Fixed (+$)</option>
              </select>
            </div>
            <div>
              <label className="fp-text-dim text-xs fp-mono uppercase">Value</label>
              <input value={markupValue} onChange={(e) => setMarkupValue(e.target.value)} type="number" className="w-full mt-1.5 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm fp-mono outline-none focus:fp-gold-border" />
            </div>
            <div className="flex items-end">
              <p className="text-xs fp-text-dim">Global markup applies to all selected. Set a per-service markup on any selected row to override it. Editable later; categories auto-created.</p>
            </div>
          </div>

          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 fp-text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the provider catalog…" className="w-full fp-panel-raised border fp-line-soft rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:fp-gold-border" />
          </div>

          {provCatalog === null ? (
            <p className="fp-text-faint text-sm py-6 text-center">Loading catalog…</p>
          ) : provCatalog.length === 0 ? (
            <p className="fp-text-faint text-sm py-6 text-center">No services returned by this provider.</p>
          ) : (
            <>
              {/* Prominent select-all bar */}
              <div className="flex items-center justify-between mb-2 px-3 py-2.5 rounded-lg fp-gold-soft-bg border fp-gold-border">
                <label className="flex items-center gap-2.5 text-sm cursor-pointer font-medium">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-[#C9A574]" />
                  Select all shown ({selectableIds.length})
                </label>
                <span className="fp-gold text-xs fp-mono">{selected.size} selected</span>
              </div>
              <div className="max-h-80 overflow-y-auto border fp-line-soft rounded-lg divide-y divide-[#1E212A]">
                {filtered.map((s) => {
                  const id = String(s.service);
                  const done = importedIds.has(id);
                  const isSel = selected.has(id);
                  const effMarkup = perMarkup[id] !== undefined && perMarkup[id] !== "" ? Number(perMarkup[id]) : Number(markupValue);
                  return (
                    <label key={id} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${done ? "opacity-50" : "cursor-pointer hover:fp-panel-raised"}`}>
                      <input type="checkbox" disabled={done} checked={isSel} onChange={() => toggleSel(id)} className="accent-[#C9A574]" />
                      <span className="flex-1 min-w-0">
                        <span className="truncate block">{s.name}</span>
                        <span className="fp-text-faint text-[11px] fp-mono">#{id} · {s.category} · min {s.min} · max {s.max}</span>
                      </span>
                      {isSel && !done ? (
                        <span className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span className="fp-text-faint text-[10px] fp-mono uppercase hidden sm:inline">Markup</span>
                          <span className="relative flex items-center">
                            <input
                              type="number"
                              value={perMarkup[id] ?? ""}
                              onChange={(e) => setPerMarkup((m) => ({ ...m, [id]: e.target.value }))}
                              placeholder={`${markupValue} (global)`}
                              title="Set a custom markup for this service — leave blank to use the global markup"
                              className="w-24 fp-panel border fp-gold-border rounded px-2 py-1 pr-5 text-xs fp-mono outline-none focus:fp-gold-border"
                            />
                            <span className="absolute right-2 fp-text-faint text-[11px] pointer-events-none">{markupKind === "percent" ? "%" : markupKind === "multiplier" ? "×" : "$"}</span>
                          </span>
                          <span className="fp-gold fp-mono text-xs w-16 text-right">{fmtMoney(computeSellRate(Number(s.rate), markupKind, Number.isNaN(effMarkup) ? 0 : effMarkup))}/1k</span>
                        </span>
                      ) : done ? (
                        <span className="fp-mono text-xs fp-text-dim shrink-0">${Number(s.rate).toFixed(2)}/1k · imported</span>
                      ) : (
                        <span className="fp-mono text-xs shrink-0 text-right whitespace-nowrap">
                          <span className="fp-text-faint">${Number(s.rate).toFixed(2)}</span>
                          <span className="fp-text-faint"> → </span>
                          <span className="fp-gold">{fmtMoney(computeSellRate(Number(s.rate), markupKind, Number(markupValue) || 0))}</span>
                          <span className="fp-text-faint">/1k</span>
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={doImport} disabled={busy || selected.size === 0} className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
                  {busy ? "Importing…" : selected.size ? `Import ${selected.size} selected` : "Import selected"}
                </button>
                <button onClick={() => setImportOpen(false)} className="fp-panel border fp-line-soft text-xs px-4 py-2 rounded-lg fp-text-dim">Cancel</button>
              </div>
            </>
          )}
        </Card>
      )}

      <Card
        title="Catalog — categories & pricing"
        icon={Sliders}
        right={
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={doReorganize} disabled={busy} title="Rebuild categories (platform → type) from service names" className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim flex items-center gap-1 disabled:opacity-50">
              <Tag size={12} /> Re-organize
            </button>
            <button onClick={doSync} disabled={busy || providers.length === 0} className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim flex items-center gap-1 disabled:opacity-50">
              <RefreshCw size={12} /> Sync
            </button>
            <button onClick={openImport} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1">
              <Download size={13} /> Import from provider
            </button>
          </div>
        }
      >
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 fp-text-faint" />
          <input
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
            placeholder="Search catalog by service name, panel ID, or provider ID…"
            className="w-full fp-panel-raised border fp-line-soft rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:fp-gold-border"
          />
        </div>
        {sel.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-3 p-2.5 rounded-lg fp-gold-soft-bg border fp-gold-border">
            <span className="text-sm fp-gold font-medium mr-1">{sel.size} selected</span>
            <button onClick={bulkEnable} disabled={busy} className="text-xs fp-panel border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-50">Enable</button>
            <button onClick={bulkDisable} disabled={busy} className="text-xs fp-panel border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-50">Disable</button>
            <button onClick={() => setBulkMkOpen((v) => !v)} className="text-xs fp-panel border fp-line-soft rounded-lg px-3 py-1.5">Set markup</button>
            <button onClick={bulkDelete} disabled={busy} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 disabled:opacity-50">Delete</button>
            <button onClick={clearSel} className="text-xs fp-text-dim ml-auto">Clear</button>
            {bulkMkOpen && (
              <div className="w-full flex items-center gap-2 mt-2">
                <select value={bulkKind} onChange={(e) => setBulkKind(e.target.value as MarkupKind)} className="fp-panel border fp-line-soft rounded-lg px-2 py-1.5 text-xs outline-none focus:fp-gold-border">
                  <option value="percent">Percent (+%)</option>
                  <option value="multiplier">Multiplier (×)</option>
                  <option value="fixed">Fixed (+$)</option>
                </select>
                <input value={bulkVal} onChange={(e) => setBulkVal(e.target.value)} type="number" className="fp-panel border fp-line-soft rounded-lg px-2 py-1.5 text-xs fp-mono w-24 outline-none focus:fp-gold-border" />
                <button onClick={bulkMarkup} disabled={busy} className="fp-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">Apply markup</button>
              </div>
            )}
          </div>
        )}
        {catalogFiltered.length > 0 && (
          <label className="flex items-center gap-2 mb-3 text-xs fp-text-dim cursor-pointer select-none">
            <input
              type="checkbox"
              checked={catalogAllSelected}
              onChange={toggleCatalogSelectAll}
              className="accent-[#C9A574]"
            />
              Select all services ({allServiceIds.length})
          </label>
        )}
        {catalog === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading catalog…</p>
        ) : catalogFiltered.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">
            {catalogSearch.trim()
              ? `No catalog services match "${catalogSearch}".`
              : "No services yet. Import them from a connected provider — categories are created automatically."}
          </p>
        ) : (
          <div className="space-y-2">
            {catalogFiltered.map((p) => {
              const pk = p.id ?? `_${p.name}`;
              const pOpen = openP.has(pk);
              return (
                <div key={pk} className="border fp-line-soft rounded-xl overflow-hidden">
                  <div className="w-full flex items-center gap-2 px-4 py-3 fp-panel-raised">
                    <button onClick={() => togglePlatform(pk)} className="flex-1 min-w-0 flex items-center gap-2 text-sm font-medium">
                      <ChevronDown size={14} className={`fp-text-faint transition-transform shrink-0 ${pOpen ? "" : "-rotate-90"}`} />
                      <span className="w-6 h-6 rounded-md fp-panel border fp-line-soft flex items-center justify-center fp-text-dim shrink-0">
                        <PlatformGlyph platform={p.platformKey ?? ""} pathOverride={p.icon} size={13} />
                      </span>
                      <span className="truncate">{p.name}</span>
                    </button>
                    <span className="fp-text-faint text-xs fp-mono shrink-0">{p.count} service{p.count === 1 ? "" : "s"}</span>
                    {p.platformKey && (
                      <button
                        onClick={() => setLogoEdit(logoEdit?.key === p.platformKey ? null : { key: p.platformKey!, value: p.icon ?? "" })}
                        title="Add / edit platform logo"
                        className="shrink-0 text-xs fp-text-dim hover:fp-gold px-2 py-1 rounded-lg border fp-line-soft flex items-center gap-1"
                      >
                        <ImageIcon size={12} /> Logo
                      </button>
                    )}
                    <button
                      onClick={() => doDeleteCategory(p.id, p.name, p.subs.flatMap((s) => s.services.map((x) => x.id)))}
                      title="Delete this category and all its services"
                      className="shrink-0 text-red-400 hover:text-red-300 px-1.5 py-1"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {logoEdit?.key === p.platformKey && (
                    <div className="px-4 py-3 border-t fp-line-soft fp-panel space-y-2">
                      <p className="fp-text-dim text-[11px] fp-mono uppercase">Platform logo — monochrome SVG path (the <code>d=</code> value)</p>
                      <div className="flex items-start gap-3">
                        <span className="w-10 h-10 rounded-lg fp-panel-raised border fp-line-soft flex items-center justify-center fp-text-dim shrink-0">
                          <PlatformGlyph platform={p.platformKey ?? ""} pathOverride={logoEdit.value} size={20} />
                        </span>
                        <textarea
                          value={logoEdit.value}
                          onChange={(e) => setLogoEdit({ key: logoEdit.key, value: e.target.value })}
                          rows={2}
                          placeholder='e.g. M20.45 20.45h-3.55v-5.57c0-1.33...'
                          className="flex-1 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-xs fp-mono outline-none focus:fp-gold-border"
                        />
                      </div>
                      <p className="fp-text-faint text-[11px]">Paste the <code>d</code> attribute from any 24×24 monochrome icon (search e.g. “LinkedIn simpleicons svg”). Leave empty to clear.</p>
                      <div className="flex gap-2">
                        <button onClick={saveLogo} disabled={busy} className="fp-btn-primary text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50">Save logo</button>
                        <button onClick={() => setLogoEdit(null)} className="fp-panel border fp-line-soft text-xs px-4 py-1.5 rounded-lg fp-text-dim">Cancel</button>
                      </div>
                    </div>
                  )}

                  {pOpen && (
                    <div className="px-2 pb-2 pt-1 space-y-1">
                      {p.subs.map((sub) => {
                        const sk = `${pk}::${sub.id ?? sub.name}`;
                        const sOpen = openS.has(sk);
                        const subIds = sub.services.map((x) => x.id);
                        return (
                          <div key={sk} className="rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2 px-2">
                              <button onClick={() => toggleSubOpen(sk)} className="flex-1 flex items-center justify-between px-1 py-2 hover:fp-panel-raised rounded-lg">
                                <span className="flex items-center gap-2 text-sm fp-text-dim">
                                  <ChevronDown size={12} className={`fp-text-faint transition-transform ${sOpen ? "" : "-rotate-90"}`} />
                                  <Tag size={12} className="fp-gold" /> {sub.name}
                                </span>
                                <span className="fp-text-faint text-[11px] fp-mono">{sub.services.length}</span>
                              </button>
                              <button
                                onClick={() => doDeleteCategory(sub.id, sub.name, subIds)}
                                title="Delete this category and its services"
                                className="shrink-0 text-red-400 hover:text-red-300 px-1.5 py-1.5"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>

                            {sOpen && (
                              <div className="pl-3">
                                {sub.services.map((s) => (
                                  <div key={s.id} className="border-t fp-line-soft py-2.5">
                                    {editing === s.id ? (
                                      <div className="fp-panel-raised border fp-line-soft rounded-lg p-3 space-y-3">
                                        <div>
                                          <label className="fp-text-dim text-[10px] fp-mono uppercase">Display name</label>
                                          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-full mt-1 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border" />
                                        </div>
                                        <div>
                                          <label className="fp-text-dim text-[10px] fp-mono uppercase">Description</label>
                                          <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={2} className="w-full mt-1 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                          <div>
                                            <label className="fp-text-dim text-[10px] fp-mono uppercase">Markup type</label>
                                            <select value={edit.markupKind} onChange={(e) => setEdit({ ...edit, markupKind: e.target.value as MarkupKind })} className="w-full mt-1 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border">
                                              <option value="percent">Percent (+%)</option>
                                              <option value="multiplier">Multiplier (×)</option>
                                              <option value="fixed">Fixed (+$)</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="fp-text-dim text-[10px] fp-mono uppercase">Value</label>
                                            <input value={edit.markupValue} onChange={(e) => setEdit({ ...edit, markupValue: e.target.value })} type="number" className="w-full mt-1 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-mono outline-none focus:fp-gold-border" />
                                          </div>
                                        </div>
                                        <p className="text-xs fp-text-dim">
                                          Cost {fmtMoney(s.providerRate)} → sell{" "}
                                          <span className="fp-gold fp-mono">{fmtMoney(computeSellRate(s.providerRate, edit.markupKind, Number(edit.markupValue) || 0))}</span>
                                          {" "}/ 1k
                                        </p>
                                        <div className="flex gap-2">
                                          <button onClick={saveEdit} disabled={busy} className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Save</button>
                                          <button onClick={() => setEditing(null)} className="fp-panel border fp-line-soft text-xs px-4 py-2 rounded-lg fp-text-dim">Cancel</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-3">
                                        <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggleRowSel(s.id)} className="shrink-0 accent-[#C9A574]" />
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm truncate">{s.name}</p>
                                          <p className="fp-text-faint text-[10px] fp-mono">
                                            ID {s.localId ?? "—"} · prov #{s.providerServiceId} · cost {fmtMoney(s.providerRate)} ·{" "}
                                            {s.markupKind === "percent" ? `+${s.markupValue}%` : s.markupKind === "multiplier" ? `×${s.markupValue}` : `+${fmtMoney(s.markupValue)}`} ·{" "}
                                            sell <span className="fp-text-dim">{fmtMoney(s.sellRate)}</span> ·{" "}
                                            profit <span className="fp-safe">{fmtMoney(s.profit)}</span>
                                          </p>
                                        </div>
                                        <button onClick={() => toggleStatus(s)} aria-label="Toggle enabled" className="shrink-0">
                                          <Toggle on={s.status === "active"} />
                                        </button>
                                        <button onClick={() => startEdit(s)} className="shrink-0 text-xs fp-text-dim hover:fp-text px-2 py-1">Edit</button>
                                        <button onClick={() => doDelete(s)} aria-label="Delete" className="shrink-0 text-red-400 hover:text-red-300 px-1"><Trash2 size={13} /></button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

export function CategoriesTab() {
  return (
    <Card title="Categories" icon={Tag} right={<button className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg">+ New category</button>}>
      {categoriesData.map((c) => (
        <div key={c.name} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex flex-col gap-0.5 fp-text-faint">
              <ChevronDown size={10} className="rotate-180" />
              <ChevronDown size={10} />
            </div>
            {c.name} <span className="fp-text-faint text-xs">({c.count} services)</span>
          </div>
          <div className="flex items-center gap-3 text-xs fp-text-dim">
            <button>Rename</button>
            <button>{c.hidden ? "Unhide" : "Hide"}</button>
            <button className="text-red-400">Delete</button>
          </div>
        </div>
      ))}
    </Card>
  );
}

export function FloorTab() {
  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <FloorLedger />
      <Card title="How the floor works" icon={ShieldCheck}>
        <p className="fp-text-dim text-sm leading-relaxed">
          Each service&apos;s minimum price is set automatically to what your connected provider charges.
          You can raise prices freely — the floor prevents pricing any service at a loss, even by accident.
          Customers never see this floor, provider cost, or Innvil&apos;s commission — only their price.
        </p>
      </Card>
    </div>
  );
}

const ORDER_FILTERS: Array<{ k: OrderStatus | "all"; label: string }> = [
  { k: "all", label: "All" },
  { k: "pending", label: "Pending" },
  { k: "processing", label: "Processing" },
  { k: "in_progress", label: "In progress" },
  { k: "completed", label: "Completed" },
  { k: "partial", label: "Partial" },
  { k: "duplicate", label: "Duplicate" },
  { k: "canceled", label: "Canceled" },
  { k: "refunded", label: "Refunded" },
  { k: "failed", label: "Failed" },
];

const ORDERS_AUTO_REFRESH_MS = 30_000;
const ORDERS_PAGE_SIZE = 20;

export function OrdersTab({ panelId, onManageCustomer }: { panelId: string; onManageCustomer?: (customerAccountId: string) => void }) {
  const realPanel = isUuid(panelId);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminOrderVM[] | null>(() =>
    realPanel ? readAdminCache<AdminOrderVM[]>(panelId, `orders:all:0`) : []
  );
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [retryingHeld, setRetryingHeld] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalOrders, setTotalOrders] = useState(0);
  const [allOrders, setAllOrders] = useState(0);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [commentsView, setCommentsView] = useState<string[] | null>(null);
  const [refundTarget, setRefundTarget] = useState<AdminOrderVM | null>(null);
  const [refundAmountInput, setRefundAmountInput] = useState("");
  const [confirmAction, setConfirmAction] = useState<
    | null
    | {
        kind: "bulkResend" | "bulkCancel";
        ids: string[];
      }
  >(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!realPanel || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const cached = readAdminCache<AdminOrderVM[]>(panelId, `orders:${status}:${page}`);
      if (cached) setRows(cached);
      const [list, cur] = await Promise.all([
        listPanelOrdersPage(panelId, { status, page, pageSize: ORDERS_PAGE_SIZE }),
        getPanelCurrency(panelId),
      ]);
      setRows(list.rows);
      setHasNextPage(list.hasNext);
      setTotalOrders(list.totalCount);
      setAllOrders(list.allCount);
      setCurrency(cur);
      writeAdminCache(panelId, `orders:${status}:${page}`, list.rows);
    } finally {
      loadingRef.current = false;
    }
  }, [page, panelId, realPanel, status]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setPage(0);
    setExpanded(null);
    setSel(new Set());
  }, [status]);

  useEffect(() => {
    setExpanded(null);
    setSel(new Set());
  }, [page]);

  useEffect(() => {
    if (!realPanel) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (syncing || retryingHeld || busyId) return;
      void load();
    }, ORDERS_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [busyId, load, realPanel, retryingHeld, syncing]);

  const fmt = (n: number) => formatMoney(n, currency);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (!needle) return true;
      return (
        o.shortId.includes(needle) ||
        o.serviceName.toLowerCase().includes(needle) ||
        (o.customerUsername ?? "").toLowerCase().includes(needle) ||
        (o.customerEmail ?? "").toLowerCase().includes(needle) ||
        o.link.toLowerCase().includes(needle)
      );
    });
  }, [rows, status, q]);

  const statusCounts = useMemo(() => {
    const base = rows ?? [];
    const c: Record<string, number> = {
      all: allOrders,
      pending: 0,
      processing: 0,
      in_progress: 0,
      completed: 0,
      partial: 0,
      canceled: 0,
      refunded: 0,
      failed: 0,
    };
    for (const o of base) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [allOrders, rows]);

  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusyId(id); setMsg(null);
    const res = await fn();
    if (!res.ok) { setMsg({ text: res.error ?? "Action failed.", error: true }); setBusyId(null); return; }
    setMsg({ text: okMsg });
    await load();
    setBusyId(null);
  };

  const doRefund = async (o: AdminOrderVM) => {
    setRefundTarget(o);
    setRefundAmountInput("");
  };

  const confirmRefund = async () => {
    if (!refundTarget) return;
    const trimmed = refundAmountInput.trim();
    const amount = trimmed === "" ? undefined : Number(trimmed);
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      setMsg({ text: "Enter a valid amount.", error: true });
      return;
    }
    const target = refundTarget;
    setRefundTarget(null);
    await act(target.id, () => refundOrder(target.id, amount), "Refund issued.");
  };

  const syncNow = async () => {
    setSyncing(true); setMsg(null);
    const res = await syncOrdersNow(panelId);
    if (!res.ok) setMsg({ text: res.error, error: true });
    else { setMsg({ text: `Synced ${res.checked} order(s), ${res.updated} updated.` }); await load(); }
    setSyncing(false);
  };

  const retryHeldNow = async () => {
    setRetryingHeld(true); setMsg(null);
    try {
      const res = await refreshProviderBalancesAndRetryHeldOrders(panelId);
      if (!res.ok) {
        setMsg({ text: res.error, error: true });
        return;
      }
      try {
        const providerRows = await listProviders(panelId);
        writeAdminCache(panelId, "providers", providerRows);
      } catch {
        // Keep the existing provider-tab cache if the refresh read fails.
      }
      await load();
      if (res.heldFound === 0) {
        setMsg({ text: "No held orders are waiting on provider balance." });
      } else if (res.providersFunded === 0 || res.retried === 0) {
        setMsg({ text: `Checked ${res.providersChecked} provider${res.providersChecked === 1 ? "" : "s"}; none of the held orders have enough refreshed provider balance yet.` });
      } else {
        setMsg({ text: `Refreshed ${res.providersChecked} provider${res.providersChecked === 1 ? "" : "s"}; retried ${res.retried} held order${res.retried === 1 ? "" : "s"}, ${res.resent} resent${res.failed ? `, ${res.failed} still pending` : ""}.` });
      }
    } finally {
      setRetryingHeld(false);
    }
  };

  // Selection + mass cancel (owner cancel auto-refunds).
  const cancelable = (o: AdminOrderVM) => o.status !== "canceled" && o.status !== "refunded";
  const selectableIds = useMemo(() => filtered.filter(cancelable).map((o) => o.id), [filtered]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => sel.has(id));
  const toggleSel = (id: string) => setSel((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleSelectAll = () => setSel((prev) =>
    allSelected ? new Set([...prev].filter((id) => !selectableIds.includes(id))) : new Set([...prev, ...selectableIds])
  );
  const runBulkCancel = async (ids: string[]) => {
    if (!ids.length) return;
    setSyncing(true); setMsg(null);
    const res = await bulkCancelAndRefund(ids);
    setSyncing(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Canceled & refunded ${res.canceled} order(s).` });
    setSel(new Set());
    await load();
  };

  const runBulkResend = async (ids: string[]) => {
    if (!ids.length) return;
    setSyncing(true); setMsg(null);
    const res = await bulkResendOrders(ids);
    setSyncing(false);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    const details = res.errors.length ? ` ${res.errors.join(" | ")}` : "";
    setMsg({ text: `Requested ${res.requested}: resent ${res.resent}, skipped ${res.skipped}, failed ${res.failed}.${details}` });
    setSel(new Set());
    await load();
  };

  const requestBulkCancel = () => {
    const ids = [...sel];
    if (!ids.length) return;
    setConfirmAction({ kind: "bulkCancel", ids });
  };

  const requestBulkResend = () => {
    const ids = [...sel];
    if (!ids.length) return;
    setConfirmAction({ kind: "bulkResend", ids });
  };

  const confirmBulkAction = async () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    if (action.kind === "bulkCancel") {
      await runBulkCancel(action.ids);
      return;
    }
    await runBulkResend(action.ids);
  };

  const previousPage = () => setPage((p) => Math.max(0, p - 1));
  const nextPage = () => setPage((p) => p + 1);

  if (!realPanel) {
    return (
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-6 text-center fp-text-dim text-sm">
        Save this panel to manage real orders here.
      </div>
    );
  }

  return (
    <>
    {refundTarget && (
      <RefundAmountModal
        orderId={refundTarget.shortId}
        maxAmount={refundTarget.charge}
        value={refundAmountInput}
        busy={busyId === refundTarget.id}
        onChange={setRefundAmountInput}
        onCancel={() => setRefundTarget(null)}
        onConfirm={confirmRefund}
      />
    )}
    {confirmAction && (
      <ConfirmActionModal
        title={confirmAction.kind === "bulkResend" ? "Resend Selected Orders" : "Cancel & Refund Selected Orders"}
        message={confirmAction.kind === "bulkResend"
          ? `Resend ${confirmAction.ids.length} selected order(s) to the provider? Only pending/duplicate orders can be resent.`
          : `Cancel & refund ${confirmAction.ids.length} selected order(s)? Customers will be refunded automatically.`}
        confirmLabel={confirmAction.kind === "bulkResend" ? "Resend now" : "Cancel & refund"}
        danger={confirmAction.kind === "bulkCancel"}
        busy={syncing}
        onCancel={() => setConfirmAction(null)}
        onConfirm={confirmBulkAction}
      />
    )}
    {commentsView && <CommentsModal comments={commentsView} onClose={() => setCommentsView(null)} />}
    <Card
      title="Orders"
      icon={ListOrdered}
      right={
        <div className="flex items-center gap-2">
          <button onClick={retryHeldNow} disabled={syncing || retryingHeld} className="fp-panel-raised border fp-line-soft text-xs px-3 py-1.5 rounded-lg fp-text-dim hover:fp-text flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={12} className={retryingHeld ? "animate-spin" : ""} /> {retryingHeld ? "Refreshing…" : "Refresh & Resend"}
          </button>
          <button onClick={syncNow} disabled={syncing || retryingHeld} className="fp-panel-raised border fp-line-soft text-xs px-3 py-1.5 rounded-lg fp-text-dim hover:fp-text flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync statuses"}
          </button>
        </div>
      }
    >
      {msg && <p className={`text-xs mb-3 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <StatCard label="Pending" value={String(statusCounts.pending)} />
        <StatCard label="Processing" value={String(statusCounts.processing)} tone="gold" />
        <StatCard label="In progress" value={String(statusCounts.in_progress)} tone="gold" />
        <StatCard label="Completed" value={String(statusCounts.completed)} tone="safe" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 overflow-x-auto">
          {ORDER_FILTERS.map((f) => (
            <button
              key={f.k}
              onClick={() => setStatus(f.k)}
              className={`text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap border ${status === f.k ? "fp-gold-border fp-gold-soft-bg fp-gold" : "fp-line-soft fp-panel-raised fp-text-dim"}`}
            >
              {f.label} ({statusCounts[f.k] ?? 0})
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 fp-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search id, service, customer…"
            className="fp-panel-raised border fp-line-soft rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:fp-gold-border w-56"
          />
        </div>
      </div>

      {sel.size > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2.5 rounded-lg fp-gold-soft-bg border fp-gold-border">
          <span className="text-xs fp-gold">{sel.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSel(new Set())} className="text-xs fp-text-dim hover:fp-text">Clear</button>
            <button onClick={requestBulkResend} disabled={syncing || retryingHeld || busyId !== null} className="text-xs font-semibold px-3 py-1.5 rounded-lg border fp-line-soft fp-panel-raised fp-text-dim hover:fp-text disabled:opacity-50">
              Resend selected to provider
            </button>
            <button onClick={requestBulkCancel} disabled={syncing} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 disabled:opacity-50">
              Cancel &amp; refund selected
            </button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">
          {rows.length === 0 ? "No orders yet. They'll appear here as customers order." : "No orders match this filter."}
        </p>
      ) : (
        <div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                <th className="py-2 font-normal w-8"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="accent-[#C9A574]" aria-label="Select all" /></th>
                <th className="py-2 font-normal">ID</th>
                <th className="py-2 font-normal">Service</th>
                <th className="py-2 font-normal">Customer</th>
                <th className="py-2 font-normal">Link</th>
                <th className="py-2 font-normal text-right">Qty</th>
                <th className="py-2 font-normal text-right">Charge</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const busy = busyId === o.id;
                const open = expanded === o.id;
                return (
                  <React.Fragment key={o.id}>
                    <tr className="border-b fp-line-soft last:border-0">
                      <td className="py-3">{cancelable(o) && <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} className="accent-[#C9A574]" aria-label="Select order" />}</td>
                      <td className="py-3 fp-mono fp-text-dim">#{o.orderNo ?? o.shortId}</td>
                      <td className="py-3">
                        {o.serviceName}{o.serviceNo != null && <span className="fp-text-faint"> · #{o.serviceNo}</span>}
                        {o.comments && (
                          <button onClick={() => setCommentsView(o.comments)} title="View comments" className="ml-1.5 fp-gold align-middle"><FileText size={12} /></button>
                        )}
                      </td>
                      <td className="py-3 fp-text-dim">
                        {o.customerUsername ? (
                          <button
                            onClick={() => onManageCustomer?.(o.customerAccountId)}
                            className="hover:fp-gold underline underline-offset-2"
                            title="Open customer management"
                          >
                            {o.customerUsername}
                          </button>
                        ) : (
                          o.customerEmail ?? "—"
                        )}
                      </td>
                      <td className="py-3 max-w-[280px]">
                        {(() => {
                          const label = o.link.length > 42 ? `${o.link.slice(0, 42)}…` : o.link;
                          try {
                            const href = new URL(o.link).toString();
                            return (
                              <a href={href} target="_blank" rel="noreferrer noopener" className="fp-mono text-xs break-all hover:fp-gold underline underline-offset-2" title={o.link}>
                                {label}
                              </a>
                            );
                          } catch {
                            return <span className="fp-mono text-xs break-all" title={o.link}>{label}</span>;
                          }
                        })()}
                      </td>
                      <td className="py-3 text-right fp-mono">{o.quantity.toLocaleString()}</td>
                      <td className="py-3 text-right fp-mono">{fmt(o.charge)}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <OrderStatusPill status={o.status} />
                          {o.held && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> On hold</span>}
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <button onClick={() => setExpanded(open ? null : o.id)} className="fp-gold text-xs">
                          {open ? "Hide" : "Manage"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={9} className="pb-4">
                          <div className="fp-panel-raised border fp-line-soft rounded-lg p-4 space-y-3 text-xs">
                            {o.held && (
                              <p className="text-red-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> Your provider&apos;s API balance was insufficient. Please add balance to the provider, then <strong>Resend to provider</strong>. If left unfunded, this order stays customer-visible as processing and auto-refunds 24h after it was placed{o.failReason ? ` (${o.failReason})` : ""}.</p>
                            )}
                            {o.failReason && !o.held && (
                              <p className="text-red-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> Provider reason: {o.failReason}</p>
                            )}
                            {(() => {
                              try {
                                const href = new URL(o.link).toString();
                                return (
                                  <p>
                                    <span className="fp-text-faint">Link:</span> {" "}
                                    <a href={href} target="_blank" rel="noreferrer noopener" className="fp-mono break-all hover:fp-gold underline underline-offset-2">
                                      {o.link}
                                    </a>
                                  </p>
                                );
                              } catch {
                                return <p><span className="fp-text-faint">Link:</span> <span className="fp-mono break-all">{o.link}</span></p>;
                              }
                            })()}
                            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                              <p>
                                <span className="fp-text-faint">Provider:</span>{" "}
                                <span>{o.providerName ?? "—"}</span>
                              </p>
                              <p className="sm:col-span-2 lg:col-span-2">
                                <span className="fp-text-faint">Provider link:</span>{" "}
                                {(() => {
                                  if (!o.providerLink) return <span className="fp-mono">—</span>;
                                  try {
                                    const href = new URL(o.providerLink).toString();
                                    return (
                                      <a href={href} target="_blank" rel="noreferrer noopener" className="fp-mono break-all hover:fp-gold underline underline-offset-2">
                                        {o.providerLink}
                                      </a>
                                    );
                                  } catch {
                                    return <span className="fp-mono break-all">{o.providerLink}</span>;
                                  }
                                })()}
                              </p>
                              <p><span className="fp-text-faint">Provider order:</span> <span className="fp-mono">{o.providerOrderId ?? "—"}</span></p>
                              <p><span className="fp-text-faint">Provider cost:</span> {fmt(o.providerCost)}</p>
                              <p><span className="fp-text-faint">Profit:</span> <span className="fp-safe">{fmt(o.profit)}</span></p>
                              {o.remains != null && <p><span className="fp-text-faint">Remains:</span> {o.remains.toLocaleString()}</p>}
                              <p><span className="fp-text-faint">Placed:</span> {new Date(o.createdAt).toLocaleString()}</p>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              {o.status === "pending" && !o.providerOrderId && (
                                <button disabled={busy} onClick={() => act(o.id, () => resendOrder(o.id), "Resent to provider.")} className="fp-panel border fp-line-soft rounded px-2.5 py-1.5 fp-text-dim hover:fp-text disabled:opacity-50">Resend to provider</button>
                              )}
                              {o.providerOrderId && (
                                <>
                                  <button disabled={busy} onClick={() => act(o.id, () => requestRefill(o.id), "Refill requested.")} className="fp-panel border fp-line-soft rounded px-2.5 py-1.5 fp-text-dim hover:fp-text disabled:opacity-50">Request refill</button>
                                  <button disabled={busy} onClick={() => act(o.id, () => requestCancel(o.id), "Cancel requested.")} className="fp-panel border fp-line-soft rounded px-2.5 py-1.5 fp-text-dim hover:fp-text disabled:opacity-50">Request cancel</button>
                                </>
                              )}
                              {o.status !== "completed" && o.status !== "refunded" && (
                                <button disabled={busy} onClick={() => act(o.id, () => markOrderCompleted(o.id), "Marked completed.")} className="fp-panel border fp-line-soft rounded px-2.5 py-1.5 fp-safe hover:opacity-80 disabled:opacity-50">Mark completed</button>
                              )}
                              {o.status !== "canceled" && o.status !== "refunded" && (
                                <button disabled={busy} onClick={() => act(o.id, () => cancelAndRefundOrder(o.id), "Canceled & refunded.")} className="fp-panel border border-red-500/30 rounded px-2.5 py-1.5 text-red-400 hover:opacity-80 disabled:opacity-50">Cancel &amp; refund</button>
                              )}
                              {o.status !== "refunded" && (
                                <button disabled={busy} onClick={() => doRefund(o)} className="fp-panel border border-red-500/30 rounded px-2.5 py-1.5 text-red-400 hover:opacity-80 disabled:opacity-50">Refund only</button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t fp-line-soft">
            <p className="text-xs fp-text-faint">
              {rows.length}/{status === "all" ? allOrders : totalOrders} orders · Page {page + 1}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={previousPage}
                disabled={page === 0 || syncing || retryingHeld || busyId !== null}
                className="fp-panel-raised border fp-line-soft text-xs px-3 py-1.5 rounded-lg fp-text-dim hover:fp-text disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={nextPage}
                disabled={!hasNextPage || syncing || retryingHeld || busyId !== null}
                className="fp-panel-raised border fp-line-soft text-xs px-3 py-1.5 rounded-lg fp-text-dim hover:fp-text disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
    </>
  );
}

function RefundAmountModal({
  orderId,
  maxAmount,
  value,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  orderId: string;
  maxAmount: number;
  value: string;
  busy?: boolean;
  onChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCancel}>
      <div className="w-full max-w-md fp-panel border fp-line rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b fp-line-soft">
          <p className="fp-display text-sm flex items-center gap-2"><CreditCard size={14} className="text-red-400" /> Refund order #{orderId}</p>
          <button onClick={onCancel} className="fp-text-faint hover:fp-text" aria-label="Close refund modal"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="text-sm fp-text-dim">Leave amount blank for full refund. Maximum: <span className="fp-mono fp-text">{maxAmount}</span></p>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Full refund"
            type="number"
            min="0"
            step="0.0001"
            className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border"
            autoFocus
          />
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text disabled:opacity-50">Cancel</button>
          <button onClick={() => { void onConfirm(); }} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold border border-red-500/30 text-red-400 hover:opacity-90 disabled:opacity-50">{busy ? "Working…" : "Issue refund"}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmActionModal({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCancel}>
      <div className="w-full max-w-lg fp-panel border fp-line rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b fp-line-soft">
          <p className="fp-display text-sm flex items-center gap-2">
            {danger ? <AlertTriangle size={14} className="text-red-400" /> : <RefreshCw size={14} className="fp-gold" />}
            {title}
          </p>
          <button onClick={onCancel} className="fp-text-faint hover:fp-text" aria-label="Close confirmation">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm fp-text-dim leading-relaxed">{message}</p>
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text disabled:opacity-50">
            Keep as is
          </button>
          <button
            onClick={() => { void onConfirm(); }}
            disabled={busy}
            className={danger
              ? "rounded-lg px-3 py-2 text-sm font-semibold border border-red-500/30 text-red-400 hover:opacity-90 disabled:opacity-50"
              : "fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Floating popup that shows a Custom Comments order's comment list. */
function CommentsModal({ comments, onClose }: { comments: string[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="fp-panel border fp-line rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b fp-line-soft">
          <p className="fp-display text-sm flex items-center gap-2"><FileText size={14} /> Comments ({comments.length})</p>
          <button onClick={onClose} className="fp-text-faint hover:fp-text"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-1.5">
          {comments.map((c, i) => (
            <p key={i} className="text-sm fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 break-words">{c}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

const CUSTOMER_STATUS_TONE: Record<string, string> = {
  active: "fp-safe-soft-bg fp-safe",
  banned: "bg-red-500/10 text-red-400",
  restricted: "fp-gold-soft-bg fp-gold",
};

export function CustomersTab({ panel, focusCustomerId }: { panel: Panel; onView?: (c: CustomerRow) => void; focusCustomerId?: string | null }) {
  const realPanel = isUuid(panel.id);
  const [rows, setRows] = useState<PanelCustomerVM[] | null>(() =>
    realPanel ? readAdminCache<PanelCustomerVM[]>(panel.id, "customers") : []
  );
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [depositBusyId, setDepositBusyId] = useState<string | null>(null);
  const [depositRows, setDepositRows] = useState<Record<string, OwnerDepositVM[]>>({});
  const [detailsBusyId, setDetailsBusyId] = useState<string | null>(null);
  const [confirmTopup, setConfirmTopup] = useState<null | { kind: "commit" | "cancel"; paymentId: string; customerId: string }>(null);
  const [manageDetails, setManageDetails] = useState<Record<string, { userId: string; email: string | null; username: string | null }>>({});
  const rowsRef = useRef<PanelCustomerVM[] | null>(rows);

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const refresh = useCallback(async () => {
    if (!realPanel) {
      setRows([]);
      writeAdminCache(panel.id, "customers", []);
      return;
    }

    const cached = rowsRef.current ?? readAdminCache<PanelCustomerVM[]>(panel.id, "customers");
    if (cached) setRows(cached);

    const next = await listPanelCustomers(panel.id);
    setRows(next);
    writeAdminCache(panel.id, "customers", next);
  }, [panel.id, realPanel]);
  useEffect(() => { refresh(); }, [refresh]);

  const openAdjust = async (id: string) => {
    const nextOpen = openId === id ? null : id;
    setOpenId(nextOpen);
    setAmount(""); setReason(""); setMsg(null);
    if (!nextOpen) return;

    if (!manageDetails[id]) {
      setDetailsBusyId(id);
      const info = await getCustomerManageDetails(id);
      if (info.ok) {
        setManageDetails((prev) => ({
          ...prev,
          [id]: {
            userId: info.data.userId,
            email: info.data.email,
            username: info.data.username,
          },
        }));
      }
      setDetailsBusyId(null);
    }

    if (!depositRows[id]) {
      setDepositBusyId(id);
      const next = await listCustomerDeposits(id);
      setDepositRows((prev) => ({ ...prev, [id]: next }));
      setDepositBusyId(null);
    }
  };

  useEffect(() => {
    if (!focusCustomerId) return;
    const exists = (rows ?? []).some((r) => r.id === focusCustomerId);
    if (!exists) return;
    if (openId !== focusCustomerId) openAdjust(focusCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCustomerId, rows]);
  const adjust = async (id: string, sign: 1 | -1) => {
    const val = Number(amount);
    if (!val || val <= 0) { setMsg({ text: "Enter a positive amount.", error: true }); return; }
    setBusy(true);
    const res = await adjustCustomerBalance(id, sign * val, reason);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Balance updated to $${res.data.balance.toFixed(2)}.` });
    setOpenId(null); setAmount(""); setReason("");
    refresh();
  };
  const toggleBan = async (c: PanelCustomerVM) => {
    const next = c.status === "banned" ? "active" : "banned";
    const res = await setCustomerStatus(c.id, next);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    refresh();
  };

  const sendWelcome = async (ids: string[]) => {
    setBusy(true); setMsg(null);
    const res = await sendWelcomeToCustomers(panel.id, { customerIds: ids });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({
      text: res.sent > 0
        ? `Welcome message sent to ${res.sent} customer${res.sent === 1 ? "" : "s"}.${res.skipped ? ` ${res.skipped} skipped (already welcomed).` : ""}`
        : "Already welcomed — nothing sent.",
    });
  };

  const commitTopup = async (paymentId: string, customerId: string) => {
    setConfirmTopup({ kind: "commit", paymentId, customerId });
  };

  const runCommitTopup = async (paymentId: string, customerId: string) => {
    setBusy(true);
    const res = await commitPendingPayment(paymentId);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Pending payment committed. Balance updated to $${res.data.balance.toFixed(2)}. Ask the customer to check their wallet to confirm the credit.` });
    await refresh();
    const next = await listCustomerDeposits(customerId);
    setDepositRows((prev) => ({ ...prev, [customerId]: next }));
  };

  const cancelTopup = async (paymentId: string, customerId: string) => {
    setConfirmTopup({ kind: "cancel", paymentId, customerId });
  };

  const runCancelTopup = async (paymentId: string, customerId: string) => {
    setBusy(true);
    const res = await cancelPendingPayment(paymentId);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Pending top-up canceled. No wallet credit was applied." });
    const next = await listCustomerDeposits(customerId);
    setDepositRows((prev) => ({ ...prev, [customerId]: next }));
  };

  const confirmTopupAction = async () => {
    if (!confirmTopup) return;
    const action = confirmTopup;
    setConfirmTopup(null);
    if (action.kind === "commit") {
      await runCommitTopup(action.paymentId, action.customerId);
      return;
    }
    await runCancelTopup(action.paymentId, action.customerId);
  };

  if (!realPanel) {
    return (
      <Card tone="gold">
        <p className="text-sm fp-gold flex items-center gap-2"><AlertTriangle size={15} /> Save this panel first</p>
        <p className="text-xs fp-text-dim mt-1">Customers register on your live storefront; open a real panel to manage them.</p>
      </Card>
    );
  }

  const inputCls = "fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border";

  return (
    <Card title="Customers" icon={Users}>
      {confirmTopup && (
        <ConfirmActionModal
          title={confirmTopup.kind === "commit" ? "Credit Pending Top-up" : "Cancel Pending Top-up"}
          message={confirmTopup.kind === "commit"
            ? "This will manually mark the pending top-up as verified and credit the customer's wallet. Confirm you checked the payment provider first."
            : "Cancel this pending top-up? No wallet credit will be applied."}
          confirmLabel={confirmTopup.kind === "commit" ? "Credit now" : "Cancel top-up"}
          danger={confirmTopup.kind === "cancel"}
          busy={busy}
          onCancel={() => setConfirmTopup(null)}
          onConfirm={confirmTopupAction}
        />
      )}
      {msg && (
        <div className={`text-sm px-4 py-2.5 rounded-lg border flex items-center justify-between gap-3 mb-4 ${msg.error ? "bg-red-500/10 border-red-500/20 text-red-400" : "fp-safe-soft-bg fp-safe-border fp-safe"}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}
      {rows === null ? (
        <p className="fp-text-faint text-sm py-4 text-center">Loading customers…</p>
      ) : rows.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">No customers yet. They appear here after signing up on your storefront.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                <th className="py-2 font-normal">Customer</th>
                <th className="py-2 font-normal">Balance</th>
                <th className="py-2 font-normal">Orders</th>
                <th className="py-2 font-normal">Spent</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal text-right">Manage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <React.Fragment key={c.id}>
                  <tr className="border-b fp-line-soft last:border-0">
                    <td className="py-3 pr-3">
                      <button onClick={() => openAdjust(c.id)} className="text-left hover:fp-gold">
                        {c.username ?? c.email ?? "customer"}
                      </button>
                    </td>
                    <td className="py-3 fp-mono fp-gold">${c.balance.toFixed(2)}</td>
                    <td className="py-3 fp-mono">{c.orders}</td>
                    <td className="py-3 fp-mono">${c.spent.toFixed(2)}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full ${CUSTOMER_STATUS_TONE[c.status] ?? "fp-panel-raised fp-text-dim"}`}>{c.status}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => openAdjust(c.id)} className="text-xs fp-gold border fp-line-soft rounded-lg px-3 py-1.5 hover:fp-gold-border">Manage customer</button>
                        <button onClick={() => toggleBan(c)} className={`text-xs rounded-lg px-3 py-1.5 border ${c.status === "banned" ? "fp-safe border-[rgba(126,200,140,0.3)]" : "text-red-400 border-red-500/30"}`}>
                          {c.status === "banned" ? "Unban" : "Ban"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {openId === c.id && (
                    <tr className="border-b fp-line-soft">
                      <td colSpan={6} className="py-3">
                        <div className="space-y-4">
                          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3">
                            <p className="fp-text-faint text-[10px] fp-mono uppercase mb-2">Customer identity</p>
                            {detailsBusyId === c.id ? (
                              <p className="fp-text-faint text-sm py-2">Loading customer info…</p>
                            ) : (
                              <div className="grid sm:grid-cols-2 gap-2 text-xs">
                                <p><span className="fp-text-faint">Username:</span> <span className="fp-mono">{manageDetails[c.id]?.username ?? c.username ?? "—"}</span></p>
                                <p><span className="fp-text-faint">Email:</span> <span className="fp-mono">{manageDetails[c.id]?.email ?? c.email ?? "—"}</span></p>
                                <p><span className="fp-text-faint">Customer account ID:</span> <span className="fp-mono break-all">{c.id}</span></p>
                                <p><span className="fp-text-faint">User ID:</span> <span className="fp-mono break-all">{manageDetails[c.id]?.userId ?? c.userId}</span></p>
                              </div>
                            )}
                          </div>

                          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 flex flex-wrap items-end gap-3">
                            <div>
                              <label className="fp-text-dim text-[10px] fp-mono uppercase">Amount ($)</label>
                              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className={`${inputCls} fp-mono w-32 mt-1 block`} />
                              <p className="fp-text-faint text-[11px] mt-1">Used only for manual credit/debit adjustments.</p>
                            </div>
                            <div className="flex-1 min-w-[160px]">
                              <label className="fp-text-dim text-[10px] fp-mono uppercase">Reason (optional)</label>
                              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. bonus, correction" className={`${inputCls} w-full mt-1 block`} />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => adjust(c.id, 1)} disabled={busy} className="text-xs font-semibold px-4 py-2 rounded-lg border fp-line-soft fp-text-dim disabled:opacity-50">Credit +</button>
                              <button onClick={() => adjust(c.id, -1)} disabled={busy} className="text-xs font-semibold px-4 py-2 rounded-lg border border-red-500/30 text-red-400 disabled:opacity-50">Debit −</button>
                            </div>
                          </div>

                          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <p className="text-sm font-medium flex items-center gap-1.5"><Mail size={14} className="fp-text-dim" /> Welcome message</p>
                              <p className="fp-text-faint text-[11px] mt-0.5">Send this customer the welcome message you set up in Notifications. Skipped if they already got one.</p>
                            </div>
                            <button onClick={() => sendWelcome([c.id])} disabled={busy} className="text-xs font-semibold px-4 py-2 rounded-lg fp-panel border fp-line-soft hover:fp-gold-border disabled:opacity-50 whitespace-nowrap">
                              Send welcome
                            </button>
                          </div>

                          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3">
                            <p className="fp-text-faint text-[10px] fp-mono uppercase mb-2">Top-up record</p>
                            {depositBusyId === c.id ? (
                              <p className="fp-text-faint text-sm py-3">Loading top-ups…</p>
                            ) : (depositRows[c.id]?.length ?? 0) === 0 ? (
                              <p className="fp-text-faint text-sm py-3">No top-ups recorded yet.</p>
                            ) : (
                              <div className="space-y-2">
                                {(depositRows[c.id] ?? []).map((d) => (
                                  <div key={d.id} className="flex items-center justify-between gap-3 text-xs border-b fp-line-soft last:border-0 pb-2 last:pb-0">
                                    <div>
                                      <p className="fp-text">{d.method}</p>
                                      <p className="fp-text-faint">{new Date(d.createdAt).toLocaleString()}</p>
                                    </div>
                                    <div className="text-right flex items-center gap-2">
                                      {(d.status === "pending" || d.status === "approved") && (
                                        <>
                                          <button
                                            onClick={() => commitTopup(d.id, c.id)}
                                            disabled={busy}
                                            className="fp-btn-primary text-[11px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                                          >
                                            Commit
                                          </button>
                                          <button
                                            onClick={() => cancelTopup(d.id, c.id)}
                                            disabled={busy}
                                            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 disabled:opacity-50"
                                          >
                                            Cancel
                                          </button>
                                        </>
                                      )}
                                      <div>
                                      <p className="fp-mono fp-gold">+${d.amount.toFixed(2)}</p>
                                      <p className="fp-text-faint uppercase">{d.status}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function PaymentsTab({ panelId }: { panelId: string }) {
  type DiscountTierDraft = { minAmount: string; discountPct: string };
  const parseDiscountRulesConfig = (raw: string | undefined): DiscountTierDraft[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const minAmount = String((item as Record<string, unknown>).minAmount ?? "");
        const discountPct = String((item as Record<string, unknown>).discountPct ?? "");
        return [{ minAmount, discountPct }];
      });
    } catch {
      return [];
    }
  };

  const realPanel = isUuid(panelId);
  const fallbackMeta: PaymentsMeta = {
    catalog: [],
    fields: {},
    connected: [],
    currency: "USD",
    currencies: [],
  };
  const [meta, setMeta] = useState<PaymentsMeta | null>(() =>
    realPanel ? readAdminCache<PaymentsMeta>(panelId, "payments") : fallbackMeta
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [discountRules, setDiscountRules] = useState<DiscountTierDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<null | { id: string; label: string }>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const metaRef = useRef<PaymentsMeta | null>(meta);

  useEffect(() => { metaRef.current = meta; }, [meta]);

  const refresh = useCallback(async () => {
    if (!realPanel) {
      setMeta(fallbackMeta);
      writeAdminCache(panelId, "payments", fallbackMeta);
      return;
    }

    const cached = metaRef.current ?? readAdminCache<PaymentsMeta>(panelId, "payments");
    if (cached) setMeta(cached);

    const next = await getPaymentsMeta(panelId);
    setMeta(next);
    writeAdminCache(panelId, "payments", next);
  }, [panelId, realPanel]);
  useEffect(() => { refresh(); }, [refresh]);

  const connectedMap = useMemo(
    () => new Map((meta?.connected ?? []).map((c) => [c.gateway, c])),
    [meta]
  );

  const openForm = (id: string) => {
    setOpenId((p) => {
      const next = p === id ? null : id;
      if (next) {
        const conn = connectedMap.get(id);
        setValues({ ...(conn?.config ?? {}) });
        const parsedRules = parseDiscountRulesConfig(conn?.config?.discountRules);
        if (parsedRules.length > 0) {
          setDiscountRules(parsedRules);
        } else if (conn?.config?.discountPct) {
          setDiscountRules([{ minAmount: "0", discountPct: conn.config.discountPct }]);
        } else {
          setDiscountRules([]);
        }
      } else {
        setValues({});
        setDiscountRules([]);
      }
      return next;
    });
    setMsg(null);
  };
  const save = async (id: string, label: string) => {
    const normalizedRules = discountRules.flatMap((r) => {
      const min = String(r.minAmount ?? "").trim();
      const pct = String(r.discountPct ?? "").trim();
      if (!min && !pct) return [];
      const minNum = Number(min);
      const pctNum = Number(pct);
      if (!Number.isFinite(minNum) || minNum < 0 || !Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) return [];
      return [{ minAmount: minNum, discountPct: pctNum }];
    }).sort((a, b) => a.minAmount - b.minAmount);

    const hasInvalidRule = discountRules.some((r) => {
      const min = String(r.minAmount ?? "").trim();
      const pct = String(r.discountPct ?? "").trim();
      if (!min && !pct) return false;
      const minNum = Number(min);
      const pctNum = Number(pct);
      return !Number.isFinite(minNum) || minNum < 0 || !Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100;
    });
    if (hasInvalidRule) {
      setMsg({ text: "Each tier needs min amount >= 0 and discount between 0 and 100.", error: true });
      return;
    }

    const payload: Record<string, string> = { ...values };
    payload.discountRules = JSON.stringify(normalizedRules);
    delete payload.discountPct;

    setBusy(true); setMsg(null);
    const res = await connectGateway(panelId, id, payload);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `${label} connected.` });
    setOpenId(null); setValues({}); setDiscountRules([]);
    refresh();
  };
  const remove = async (id: string, label: string) => {
    setConfirmDisconnect({ id, label });
  };

  const runRemove = async (id: string) => {
    setBusy(true); setMsg(null);
    const res = await disconnectGateway(panelId, id);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    refresh();
  };

  const inputCls = "w-full fp-panel border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-1.5 outline-none focus:fp-gold-border fp-mono";

  if (!realPanel) {
    return (
      <Card tone="gold">
        <p className="text-sm fp-gold flex items-center gap-2"><AlertTriangle size={15} /> Save this panel first</p>
        <p className="text-xs fp-text-dim mt-1">Connect payment gateways on a real, saved panel.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {confirmDisconnect && (
        <ConfirmActionModal
          title="Disconnect Payment Method"
          message={`Disconnect ${confirmDisconnect.label}? Customers won't be able to pay with it.`}
          confirmLabel="Disconnect"
          danger
          busy={busy}
          onCancel={() => setConfirmDisconnect(null)}
          onConfirm={async () => {
            const action = confirmDisconnect;
            setConfirmDisconnect(null);
            if (!action) return;
            await runRemove(action.id);
          }}
        />
      )}
      {msg && (
        <div className={`text-sm px-4 py-2.5 rounded-lg border flex items-center justify-between gap-3 ${msg.error ? "bg-red-500/10 border-red-500/20 text-red-400" : "fp-safe-soft-bg fp-safe-border fp-safe"}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {meta && (
        <Card title="Panel currency" icon={CreditCard}>
          <p className="fp-text-dim text-sm mb-3">
            Wallets, prices, and deposits on this panel are shown and charged in this currency.
            Pick the one your gateway settles in (e.g. Razorpay → INR).
          </p>
          <select
            value={meta.currency}
            onChange={async (e) => {
              const code = e.target.value;
              setBusy(true); setMsg(null);
              const res = await setPanelCurrency(panelId, code);
              setBusy(false);
              if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
              setMsg({ text: `Currency set to ${code}.` });
              refresh();
            }}
            disabled={busy}
            className="w-full max-w-sm fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border disabled:opacity-50"
          >
            {meta.currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </Card>
      )}

      <Card title="Payment gateways" icon={CreditCard}>
        <p className="fp-text-dim text-sm mb-5">
          Bring your own gateway — connect the account <b>you</b> already have. When a
          customer&apos;s deposit confirms, the gateway notifies Innvil and the wallet updates
          automatically. Configured by you, billed to you; Innvil never touches these funds.
        </p>

        {meta === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>
        ) : (
          <div className="space-y-2">
            {meta.catalog.map((c) => {
              const conn = connectedMap.get(c.id);
              const fields = meta.fields[c.id] ?? [];
              const isOpen = openId === c.id && c.available;
              const minTopup = Number(conn?.config?.minTopup);
              const hasMinTopup = Number.isFinite(minTopup);
              const ruleCount = parseDiscountRulesConfig(conn?.config?.discountRules).length;
              const discountPct = Number(conn?.config?.discountPct);
              const hasDiscountPct = Number.isFinite(discountPct);
              return (
                <div key={c.id} className="border fp-line-soft rounded-xl overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-4 py-3 fp-panel-raised">
                    <div className="min-w-0">
                      <p className="text-sm font-medium flex items-center flex-wrap gap-x-2 gap-y-1">
                        {c.label}
                        {conn && <span className="text-[10px] fp-safe-soft-bg fp-safe px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle2 size={10} /> Connected</span>}
                        {conn && hasMinTopup && (
                          <span className="text-[10px] fp-gold-soft-bg fp-gold px-2 py-0.5 rounded-full">
                            Min ${minTopup.toFixed(2)}
                          </span>
                        )}
                        {conn && ruleCount > 0 && (
                          <span className="text-[10px] fp-safe-soft-bg fp-safe px-2 py-0.5 rounded-full">
                            {ruleCount} promo tier{ruleCount === 1 ? "" : "s"}
                          </span>
                        )}
                        {conn && ruleCount === 0 && hasDiscountPct && (
                          <span className="text-[10px] fp-safe-soft-bg fp-safe px-2 py-0.5 rounded-full">
                            +{discountPct}% promo
                          </span>
                        )}
                      </p>
                      <p className="fp-text-faint text-xs mt-0.5">{c.note}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 sm:justify-end">
                      {!c.available ? (
                        <span className="text-xs fp-text-faint px-2 py-1">Coming soon</span>
                      ) : conn ? (
                        <>
                          <button onClick={() => openForm(c.id)} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 hover:fp-gold-border flex-1 sm:flex-none">Edit</button>
                          <button onClick={() => remove(c.id, c.label)} disabled={busy} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 disabled:opacity-50 flex-1 sm:flex-none">Disconnect</button>
                        </>
                      ) : (
                        <button onClick={() => openForm(c.id)} className="fp-btn-primary text-xs font-semibold px-4 py-1.5 rounded-lg flex-1 sm:flex-none">Connect</button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-4 py-4 border-t fp-line-soft space-y-3 max-w-xl">
                      {fields.map((f) => (
                        <div key={f.key}>
                          <label className="fp-text-dim text-xs fp-mono uppercase">
                            {f.label}{f.optional ? " (optional)" : ""}
                          </label>
                          <input
                            value={values[f.key] ?? conn?.config?.[f.key] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                            type={f.secret ? "password" : "text"}
                            placeholder={conn && f.secret ? "•••••• (leave blank to keep)" : f.placeholder}
                            name={`gw-${c.id}-${f.key}`}
                            autoComplete={f.secret ? "new-password" : "off"}
                            data-lpignore="true" data-1p-ignore
                            className={inputCls}
                          />
                          {f.help && (
                            <p className="fp-text-faint text-[11px] mt-1.5 leading-relaxed">
                              {f.help.split("{APP_URL}").join(origin || "your-domain.com")}
                            </p>
                          )}
                        </div>
                      ))}
                      <div className="fp-panel-raised border fp-line-soft rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="fp-text-dim text-xs fp-mono uppercase">Top-up promo tiers</p>
                          <button
                            onClick={() => setDiscountRules((prev) => [...prev, { minAmount: "", discountPct: "" }])}
                            className="text-xs fp-gold border fp-line-soft rounded-lg px-2.5 py-1"
                          >
                            Add tier
                          </button>
                        </div>
                        <p className="fp-text-faint text-[11px]">Example: min 100, discount 5 means any top-up 100+ gets +5% bonus.</p>
                        {discountRules.length === 0 ? (
                          <p className="fp-text-faint text-xs">No per-method override. Global category tiers (if any) will apply.</p>
                        ) : (
                          <div className="space-y-2">
                            {discountRules.map((r, idx) => (
                              <div key={`${c.id}-tier-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                <input
                                  value={r.minAmount}
                                  onChange={(e) => setDiscountRules((prev) => prev.map((row, i) => (i === idx ? { ...row, minAmount: e.target.value } : row)))}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="Min top-up"
                                  className={inputCls}
                                />
                                <input
                                  value={r.discountPct}
                                  onChange={(e) => setDiscountRules((prev) => prev.map((row, i) => (i === idx ? { ...row, discountPct: e.target.value } : row)))}
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  placeholder="Discount %"
                                  className={inputCls}
                                />
                                <button
                                  onClick={() => setDiscountRules((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-xs text-red-400 border border-red-500/30 rounded-lg px-2.5"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => save(c.id, c.label)} disabled={busy} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50">
                          {busy ? "Saving…" : conn ? "Update" : `Connect ${c.label}`}
                        </button>
                        <button onClick={() => setOpenId(null)} className="fp-panel border fp-line-soft text-sm px-4 py-2.5 rounded-lg fp-text-dim">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="fp-text-faint text-[11px] leading-relaxed border-t fp-line-soft pt-3 mt-4">
          Deposit confirmations arrive via webhook, which needs a public URL — works in
          production/preview or through a tunnel, not plain localhost. &quot;Coming soon&quot;
          gateways are on the roadmap and will connect the same way.
        </p>
      </Card>

      {connectedMap.has("binance_pay") && <BinanceReviewCard panelId={panelId} />}
    </div>
  );
}

/** Owner review of Binance Pay deposits + the cached Pay history (reconcile manually). */
function BinanceReviewCard({ panelId }: { panelId: string }) {
  const [review, setReview] = React.useState<BinanceReview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);
  const [showTx, setShowTx] = React.useState(false);
  const [confirmDeposit, setConfirmDeposit] = React.useState<null | { kind: "commit" | "cancel"; id: string }>(null);

  const load = React.useCallback(() => {
    getBinanceReview(panelId).then((r) => { setReview(r); setLoading(false); }).catch(() => setLoading(false));
  }, [panelId]);
  React.useEffect(() => { load(); }, [load]);

  const commit = async (id: string) => {
    setConfirmDeposit({ kind: "commit", id });
  };

  const runCommit = async (id: string) => {
    setBusy(id); setMsg(null);
    const res = await commitPendingPayment(id);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Credited. Customer balance is now $${res.data.balance.toFixed(2)}.` });
    load();
  };
  const cancel = async (id: string) => {
    setConfirmDeposit({ kind: "cancel", id });
  };

  const runCancel = async (id: string) => {
    setBusy(id); setMsg(null);
    const res = await cancelPendingPayment(id);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Deposit canceled." });
    load();
  };

  const confirmDepositAction = async () => {
    if (!confirmDeposit) return;
    const action = confirmDeposit;
    setConfirmDeposit(null);
    if (action.kind === "commit") {
      await runCommit(action.id);
      return;
    }
    await runCancel(action.id);
  };

  const money = (n: number) => n.toFixed(2);
  const STATUS_TONE: Record<string, string> = { completed: "fp-safe", pending: "fp-gold", approved: "fp-gold", rejected: "text-red-400" };

  if (loading) return <Card title="Binance Pay review" icon={CreditCard}><p className="fp-text-faint text-sm py-4 text-center">Loading…</p></Card>;
  if (!review) return null;

  return (
    <Card title="Binance Pay review" icon={CreditCard}>
      {confirmDeposit && (
        <ConfirmActionModal
          title={confirmDeposit.kind === "commit" ? "Credit Binance Deposit" : "Cancel Binance Deposit"}
          message={confirmDeposit.kind === "commit"
            ? "Manually credit this Binance deposit? Confirm you verified the payment in your Binance account first."
            : "Cancel this pending Binance deposit? No wallet credit will be applied."}
          confirmLabel={confirmDeposit.kind === "commit" ? "Credit now" : "Cancel deposit"}
          danger={confirmDeposit.kind === "cancel"}
          busy={busy !== null}
          onCancel={() => setConfirmDeposit(null)}
          onConfirm={confirmDepositAction}
        />
      )}
      <p className="fp-text-dim text-sm mb-3">Deposits that didn&apos;t auto-credit (wrong amount, recipient, or still pending) can be verified against your Binance account and credited or canceled here.</p>
      {review.syncStale && (
        <p className="text-xs fp-gold flex items-center gap-1.5 mb-3"><AlertTriangle size={12} /> Pay history hasn&apos;t synced recently — auto-credit may be delayed. Deposits can still be verified manually below.</p>
      )}
      {msg && <p className={`text-xs mb-3 flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>}

      {review.deposits.length === 0 ? (
        <p className="fp-text-faint text-sm py-3">No Binance deposits yet.</p>
      ) : (
        <div className="space-y-2">
          {review.deposits.map((d) => (
            <div key={d.id} className="fp-panel-raised border fp-line-soft rounded-xl p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {d.customerUsername ?? d.customerEmail ?? "Customer"}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full fp-panel border fp-line-soft ${STATUS_TONE[d.status] ?? "fp-text-dim"}`}>{d.status}</span>
                  </p>
                  <p className="fp-text-faint text-[11px] mt-0.5">
                    Wants <span className="fp-mono fp-text">{money(d.amount)}</span>
                    {d.payable != null && <> · pays exactly <span className="fp-mono">{d.payable}</span> {d.currency}</>}
                    {d.bonus > 0 && <> · +{money(d.bonus)} bonus</>}
                    {d.txId && <> · tx <span className="fp-mono break-all">{d.txId}</span></>}
                  </p>
                  <p className="fp-text-faint text-[10px] mt-0.5">{new Date(d.createdAt).toLocaleString()}</p>
                </div>
                {(d.status === "pending" || d.status === "approved") && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => commit(d.id)} disabled={busy !== null} className="fp-btn-primary text-[11px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">{busy === d.id ? "…" : "Credit"}</button>
                    <button onClick={() => cancel(d.id)} disabled={busy !== null} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 disabled:opacity-50">Cancel</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setShowTx((v) => !v)} className="text-xs fp-text-dim hover:fp-text underline mt-4">{showTx ? "Hide" : "Show"} received Pay history ({review.transactions.length})</button>
      {showTx && (
        <div className="mt-2 space-y-1.5">
          {review.transactions.length === 0 ? (
            <p className="fp-text-faint text-xs">No Pay transactions cached yet.</p>
          ) : review.transactions.map((t) => (
            <div key={t.transactionId} className="flex items-center justify-between gap-2 text-[11px] fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="fp-mono truncate">{t.amount} {t.currency} · {t.orderType}{t.payerName ? ` · ${t.payerName}` : ""}</p>
                <p className="fp-text-faint fp-mono break-all">{t.transactionId} · {new Date(t.transactionTime).toLocaleString()}</p>
              </div>
              <span className={`shrink-0 ${t.used ? "fp-safe" : "fp-gold"}`}>{t.used ? "credited" : "unmatched"}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function CustomerApiTab({ panelId }: { panelId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [activeKeys, setActiveKeys] = useState(0);
  const [rows, setRows] = useState<Array<{ id: string; username: string | null; email: string | null; status: string; hasKey: boolean; updatedAt: string }>>([]);
  const [confirmRevoke, setConfirmRevoke] = useState<null | { customerId: string; label: string }>(null);

  const baseUrl = typeof window !== "undefined" ? `${window.location.origin}/api/v2` : "/api/v2";

  const load = useCallback(async () => {
    const res = await getPanelCustomerApiSummary(panelId);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setEnabled(res.enabled);
    setTotalCustomers(res.totalCustomers);
    setActiveKeys(res.activeKeys);
    setRows(res.rows);
  }, [panelId]);

  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (next: boolean) => {
    setBusy(true);
    setMsg(null);
    const res = await setPanelCustomerApiEnabled(panelId, next);
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setEnabled(next);
    setMsg({ text: `Customer API ${next ? "enabled" : "disabled"}.` });
  };

  const revokeKey = async (customerId: string, username: string | null, email: string | null) => {
    const label = username ?? email ?? "this customer";
    setConfirmRevoke({ customerId, label });
  };

  const runRevoke = async (customerId: string) => {
    setBusy(true);
    setMsg(null);
    const res = await revokeCustomerApiKey(panelId, customerId);
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setMsg({ text: "API key revoked." });
    load();
  };

  return (
    <div className="space-y-4">
      {confirmRevoke && (
        <ConfirmActionModal
          title="Revoke Customer API Key"
          message={`Revoke API key for ${confirmRevoke.label}? They will need to generate a new one.`}
          confirmLabel="Revoke key"
          danger
          busy={busy}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={async () => {
            const action = confirmRevoke;
            setConfirmRevoke(null);
            if (!action) return;
            await runRevoke(action.customerId);
          }}
        />
      )}
      {msg && (
        <div className={`text-sm px-4 py-2.5 rounded-lg border flex items-center justify-between gap-3 ${msg.error ? "bg-red-500/10 border-red-500/20 text-red-400" : "fp-safe-soft-bg fp-safe-border fp-safe"}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <Card title="Customer API" icon={KeyRound}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-medium">Enable API for this panel</p>
            <p className="fp-text-faint text-xs mt-0.5">When disabled, all `/api/v2` requests return an access-disabled error.</p>
          </div>
          <button
            onClick={() => toggleEnabled(!enabled)}
            disabled={busy}
            className="disabled:opacity-60"
            aria-label="Toggle customer API"
          >
            <Toggle on={enabled} />
          </button>
        </div>

        <div className="bg-[#131720] border border-[#1E212A] rounded-lg px-4 py-3 text-xs fp-mono mb-4 overflow-x-auto">
          <span className="fp-text-faint">Endpoint:</span> {baseUrl}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3">
            <p className="fp-text-faint text-[11px] fp-mono uppercase">Customers</p>
            <p className="fp-display text-xl mt-1">{totalCustomers}</p>
          </div>
          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3">
            <p className="fp-text-faint text-[11px] fp-mono uppercase">Active API keys</p>
            <p className="fp-display text-xl mt-1 fp-gold">{activeKeys}</p>
          </div>
        </div>
      </Card>

      <Card title="Customer API keys" icon={Users}>
        {rows.length === 0 ? (
          <p className="fp-text-faint text-sm py-4 text-center">No customers found yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="fp-text-faint text-xs fp-mono uppercase">
                <tr className="border-b fp-line-soft">
                  <th className="text-left py-2">Customer</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">API key</th>
                  <th className="text-left py-2">Updated</th>
                  <th className="text-right py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b fp-line-soft last:border-0">
                    <td className="py-2.5">{r.username ?? r.email ?? "—"}</td>
                    <td className="py-2.5 capitalize">{r.status}</td>
                    <td className="py-2.5">{r.hasKey ? <span className="fp-safe">Active</span> : <span className="fp-text-faint">None</span>}</td>
                    <td className="py-2.5">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="py-2.5 text-right">
                      {r.hasKey ? (
                        <button onClick={() => revokeKey(r.id, r.username, r.email)} disabled={busy} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 disabled:opacity-50">
                          Revoke
                        </button>
                      ) : (
                        <span className="text-xs fp-text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="fp-text-faint text-[11px] mt-3">
          Security: owners can revoke customer API keys but cannot view raw keys. Customers generate keys from their own dashboard.
        </p>
      </Card>
    </div>
  );
}

export function RiskTab() {
  return (
    <ComingSoon title="Risk & Security" icon={Lock}>
      Deposit limits, first-deposit review, duplicate-account and VPN/proxy blocking, and login
      alerts are coming soon. For now, you can ban or restrict individual customers from the
      Customers tab.
    </ComingSoon>
  );
}

export function NotificationsTab({ panelId }: { panelId: string }) {
  return (
    <div className="space-y-4 max-w-3xl">
      <WelcomeMessageCard panelId={panelId} />
      <ComingSoon title="Email notifications" icon={Bell}>
        Owner and customer email notifications (new orders, failed orders, deposits, provider errors,
        and more) are coming soon.
      </ComingSoon>
    </div>
  );
}

/** Owner edits the automated welcome message every new customer receives (+ free-credit offer). */
function WelcomeMessageCard({ panelId }: { panelId: string }) {
  const [info, setInfo] = React.useState<WelcomeInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [enabled, setEnabled] = React.useState(true);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [creditEnabled, setCreditEnabled] = React.useState(true);
  const [creditAmount, setCreditAmount] = React.useState("1");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);
  const [sendBusy, setSendBusy] = React.useState(false);
  const [sendMsg, setSendMsg] = React.useState<{ text: string; error?: boolean } | null>(null);
  const [confirmSendAll, setConfirmSendAll] = React.useState(false);

  const hydrate = React.useCallback((i: WelcomeInfo) => {
    setInfo(i);
    setEnabled(i.enabled);
    setSubject(i.subjectText);
    setBody(i.bodyText);
    setCreditEnabled(i.creditEnabled);
    setCreditAmount(String(i.creditAmount));
  }, []);

  const sendToAll = async () => {
    setConfirmSendAll(true);
  };

  const runSendToAll = async () => {
    setSendBusy(true); setSendMsg(null);
    const res = await sendWelcomeToCustomers(panelId, { all: true });
    setSendBusy(false);
    if (!res.ok) { setSendMsg({ text: res.error, error: true }); return; }
    setSendMsg({
      text: res.sent > 0
        ? `Sent to ${res.sent} customer${res.sent === 1 ? "" : "s"}.${res.skipped ? ` ${res.skipped} skipped (already welcomed).` : ""}`
        : "No customers to send to — everyone has already been welcomed.",
    });
  };

  React.useEffect(() => {
    getWelcomeSettings(panelId).then((i) => { if (i) hydrate(i); setLoading(false); }).catch(() => setLoading(false));
  }, [panelId, hydrate]);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await setWelcomeSettings(panelId, {
      enabled,
      subject: subject.trim() || null,
      body: body.trim() || null,
      creditEnabled,
      creditAmount: creditAmount.trim() === "" ? 1 : Number(creditAmount),
    });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    hydrate(res.data);
    setMsg({ text: "Welcome message saved." });
  };

  const resetDefault = async () => {
    setBusy(true); setMsg(null);
    const res = await setWelcomeSettings(panelId, { enabled, subject: null, body: null, creditEnabled, creditAmount: Number(creditAmount) || 1 });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    hydrate(res.data);
    setMsg({ text: "Reset to the default message." });
  };

  if (loading) return <Card title="Welcome message" icon={Mail}><p className="fp-text-faint text-sm py-4 text-center">Loading…</p></Card>;
  if (!info) return null;

  return (
    <Card title="Welcome message" icon={Mail}>
      {confirmSendAll && (
        <ConfirmActionModal
          title="Send Welcome to Existing Customers"
          message="Send the welcome message to all existing customers? Anyone already welcomed is skipped. Save your edits first."
          confirmLabel="Send welcome"
          busy={sendBusy}
          onCancel={() => setConfirmSendAll(false)}
          onConfirm={async () => {
            setConfirmSendAll(false);
            await runSendToAll();
          }}
        />
      )}
      <p className="fp-text-dim text-sm mb-3">
        Every new customer automatically gets this as a support message. Use
        <span className="fp-mono fp-text"> {"{panel}"}</span> for your panel name and
        <span className="fp-mono fp-text"> {"{credit}"}</span> for the free-credit amount. Edit it or turn it off.
      </p>

      <label className="flex items-center gap-2 text-sm fp-text cursor-pointer mb-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[color:var(--fp-gold,#d4af37)]" />
        Send an automated welcome to new customers
      </label>

      {enabled && (
        <div className="space-y-3">
          <label className="text-xs fp-text-dim block">
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200}
              className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border mt-1" />
          </label>
          <label className="text-xs fp-text-dim block">
            Message
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} maxLength={4000}
              className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm fp-text outline-none focus:fp-gold-border mt-1 resize-y leading-relaxed" />
          </label>

          <div className="border-t fp-line-soft pt-3">
            <label className="flex items-center gap-2 text-sm fp-text cursor-pointer">
              <input type="checkbox" checked={creditEnabled} onChange={(e) => setCreditEnabled(e.target.checked)} className="accent-[color:var(--fp-gold,#d4af37)]" />
              Grant free credit when they reply
            </label>
            {creditEnabled && (
              <label className="text-xs fp-text-dim block mt-2 max-w-[16rem]">
                Credit amount (granted once, on their first reply)
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="fp-text-faint">$</span>
                  <input type="number" min="0" step="0.01" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)}
                    className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border" />
                </div>
              </label>
            )}
            <p className="fp-text-faint text-[11px] mt-2">Credit is added to the customer&apos;s wallet as a manual adjustment — you cover it, so keep the amount small.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-4">
        {msg ? (
          <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>
        ) : <button onClick={resetDefault} disabled={busy} className="text-xs fp-text-dim hover:fp-text underline disabled:opacity-60">Reset to default</button>}
        <button onClick={save} disabled={busy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
          {busy ? "Saving…" : "Save message"}
        </button>
      </div>

      <div className="border-t fp-line-soft mt-4 pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium">Send to existing customers</p>
            <p className="fp-text-faint text-[11px] mt-0.5">New sign-ups get this automatically. Send it to customers who joined earlier — anyone already welcomed is skipped. Save your edits first.</p>
          </div>
          <button onClick={sendToAll} disabled={sendBusy} className="text-xs font-semibold px-4 py-2 rounded-lg fp-panel-raised border fp-line-soft hover:fp-gold-border disabled:opacity-60 whitespace-nowrap">
            {sendBusy ? "Sending…" : "Send to all existing customers"}
          </button>
        </div>
        {sendMsg && <p className={`text-xs mt-2 flex items-center gap-1.5 ${sendMsg.error ? "text-red-400" : "fp-safe"}`}>{sendMsg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {sendMsg.text}</p>}
      </div>
    </Card>
  );
}

export function SupportTab({ panelId }: { panelId: string }) {
  return <SupportInbox panelId={panelId} />;
}

const AUTOMATOR_TIERS: Array<{
  tier: "pro" | "business" | "business_plus";
  name: string;
  priceKey: "proPrice" | "businessPrice" | "businessPlusPrice";
  platforms: string;
  features: string[];
}> = [
  { tier: "pro", name: "Pro", priceKey: "proPrice", platforms: "X · Instagram · TikTok", features: ["Campaign automation for your customers", "Customer keyword configuration"] },
  { tier: "business", name: "Business", priceKey: "businessPrice", platforms: "Pro + Facebook · YouTube · LinkedIn · Threads · Telegram", features: ["Everything in Pro, more platforms", "AI customer support bundled"] },
  { tier: "business_plus", name: "Business+", priceKey: "businessPlusPrice", platforms: "All of your services", features: ["Everything in Business, no platform limit", "File upload (csv/xlsx/docx)", "Watched accounts · full-auto"] },
];

export function AutomationTab({ panelId }: { panelId: string }) {
  const [info, setInfo] = React.useState<PlanInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"pro" | "business" | "business_plus" | null>(null);
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  const load = React.useCallback(() => {
    getPlan(panelId).then((i) => { setInfo(i); setLoading(false); }).catch(() => setLoading(false));
  }, [panelId]);
  React.useEffect(() => { load(); }, [load]);

  const priceOf = (t: (typeof AUTOMATOR_TIERS)[number]) => (info ? (info[t.priceKey] as number) : 0);
  const breakEven = (price: number) => Math.ceil(price / 6.99);

  const subscribe = async (tier: "pro" | "business" | "business_plus") => {
    setBusy(tier); setMsg(null);
    const res = await setPlan(panelId, tier);
    setBusy(null); setPending(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setInfo(res.data);
    setMsg({ text: `Subscribed to ${tier === "business_plus" ? "Business+" : tier === "business" ? "Business" : "Pro"}. Your customers can now use the Automator.` });
  };

  const cancel = async () => {
    setBusy("cancel"); setMsg(null);
    const res = await setPlan(panelId, null);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setInfo(res.data);
    setMsg({ text: "Plan canceled." });
  };

  if (loading) return <Card title="Campaign Automation" icon={Bot}><p className="fp-text-faint text-sm py-4 text-center">Loading…</p></Card>;

  const current = info?.tier ?? null;
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

  return (
    <div className="space-y-4 max-w-3xl">
      <Card title="Campaign Automation" icon={Bot}>
        <p className="fp-text-dim text-sm mb-3">
          Subscribe to offer the <span className="fp-text">Automator</span> to your customers — they paste many
          links and it fans each out to the right services automatically. Your customers pay a monthly price
          <span className="fp-text"> you set</span> (default $6.99, or $9.99 on Business+), and <span className="fp-text">you keep all of it</span>.
        </p>
        {current ? (
          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs fp-safe flex items-center gap-1.5">
              <CheckCircle2 size={13} /> On {current === "business_plus" ? "Business+" : current === "business" ? "Business" : "Pro"}
              {info?.lapsed ? " · paused (low balance)" : ` · renews ${fmtDate(info?.nextChargeAt ?? null)}`}
            </p>
            <button onClick={cancel} disabled={busy !== null} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60 hover:fp-text">
              {busy === "cancel" ? "…" : "Cancel plan"}
            </button>
          </div>
        ) : (
          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-faint flex items-center gap-2">
            <Wallet size={13} /> Paid monthly from this panel&apos;s Innvil balance: <span className="fp-mono fp-text">${(info?.innvilBalance ?? 0).toFixed(2)}</span>
          </div>
        )}
        {msg && <p className={`text-xs mt-3 flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>}
      </Card>

      <div className="grid md:grid-cols-3 gap-3">
        {AUTOMATOR_TIERS.map((t) => {
          const price = priceOf(t);
          const isCurrent = current === t.tier;
          return (
            <div key={t.tier} className={`fp-panel border rounded-2xl p-4 flex flex-col ${isCurrent ? "fp-gold-border" : "fp-line"}`}>
              <div className="flex items-baseline justify-between">
                <p className="fp-display text-lg">{t.name}</p>
                <p className="fp-display text-xl fp-gold">${price.toFixed(2)}<span className="fp-text-faint text-xs font-normal">/mo</span></p>
              </div>
              <p className="fp-text-faint text-[11px] mt-1">{t.platforms}</p>
              <ul className="mt-3 space-y-1.5 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="fp-text-dim text-xs flex items-start gap-1.5"><CheckCircle2 size={12} className="fp-safe shrink-0 mt-0.5" /> {f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="text-[11px] fp-gold text-center mt-4">Current plan</span>
              ) : pending === t.tier ? (
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] fp-gold flex items-start gap-1.5 leading-snug">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    You pay ${price.toFixed(2)}/mo. Make sure you have <span className="fp-text">~{breakEven(price)}+ customers</span> who&apos;ll subscribe at $6.99 first, or you&apos;ll be at a loss.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => subscribe(t.tier)} disabled={busy !== null} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex-1 disabled:opacity-60">
                      {busy === t.tier ? "…" : "Confirm"}
                    </button>
                    <button onClick={() => setPending(null)} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-2 hover:fp-text">Back</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setPending(t.tier); setMsg(null); }} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-xs mt-4 hover:fp-gold-border">
                  {current ? "Switch to this" : "Subscribe"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {current && <CustomerPricingCard panelId={panelId} />}
    </div>
  );
}

/** Owner sets what their CUSTOMERS pay for the Automator subscription + an optional promo. */
function CustomerPricingCard({ panelId }: { panelId: string }) {
  const [info, setInfo] = React.useState<AutomatorPricingInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [price, setPrice] = React.useState("");
  const [promoOn, setPromoOn] = React.useState(false);
  const [promoPrice, setPromoPrice] = React.useState("");
  const [promoLabel, setPromoLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  const hydrate = React.useCallback((i: AutomatorPricingInfo) => {
    setInfo(i);
    setPrice(i.price != null ? String(i.price) : "");
    setPromoOn(i.promoActive);
    setPromoPrice(i.promoPrice != null ? String(i.promoPrice) : "");
    setPromoLabel(i.promoLabel ?? "");
  }, []);

  React.useEffect(() => {
    getAutomatorPricing(panelId).then((i) => { if (i) hydrate(i); setLoading(false); }).catch(() => setLoading(false));
  }, [panelId, hydrate]);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await setAutomatorPricing(panelId, {
      price: price.trim() === "" ? null : Number(price),
      promoActive: promoOn,
      promoPrice: promoPrice.trim() === "" ? null : Number(promoPrice),
      promoLabel: promoLabel.trim() || null,
    });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    hydrate(res.data);
    setMsg({ text: "Customer pricing saved." });
  };

  if (loading) return <Card title="Customer price" icon={Tag}><p className="fp-text-faint text-sm py-4 text-center">Loading…</p></Card>;
  if (!info) return null;

  return (
    <Card title="Customer price" icon={Tag}>
      <p className="fp-text-dim text-sm mb-3">
        What your customers pay per month to use the Automator. Leave the price blank to use the suggested
        default (<span className="fp-mono fp-text">${info.suggested.toFixed(2)}</span>
        {info.fileUpload ? " · Business+ — includes file upload + watched accounts" : ""}). You keep 100%.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs fp-text-dim">
          Monthly price
          <div className="flex items-center gap-1.5 mt-1">
            <span className="fp-text-faint">$</span>
            <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
              placeholder={info.suggested.toFixed(2)}
              className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border" />
            <span className="fp-text-faint">/mo</span>
          </div>
        </label>
        <div className="text-xs fp-text-faint flex items-end pb-2">
          Customers pay now: <span className="fp-mono fp-text ml-1">${info.effective.toFixed(2)}</span>
          {info.effective < info.base && <span className="fp-safe ml-1">(promo · was ${info.base.toFixed(2)})</span>}
        </div>
      </div>

      <div className="mt-4 border-t fp-line-soft pt-3">
        <label className="flex items-center gap-2 text-sm fp-text cursor-pointer">
          <input type="checkbox" checked={promoOn} onChange={(e) => setPromoOn(e.target.checked)} className="accent-[color:var(--fp-gold,#d4af37)]" />
          Run a promo / discount
        </label>
        {promoOn && (
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <label className="text-xs fp-text-dim">
              Promo price (must be below the regular price)
              <div className="flex items-center gap-1.5 mt-1">
                <span className="fp-text-faint">$</span>
                <input type="number" min="0" step="0.01" value={promoPrice} onChange={(e) => setPromoPrice(e.target.value)}
                  placeholder={(info.base * 0.8).toFixed(2)}
                  className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border" />
                <span className="fp-text-faint">/mo</span>
              </div>
            </label>
            <label className="text-xs fp-text-dim">
              Promo label (optional)
              <input value={promoLabel} maxLength={40} onChange={(e) => setPromoLabel(e.target.value)}
                placeholder="Launch offer"
                className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border mt-1" />
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-4">
        {msg ? (
          <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>
        ) : <span />}
        <button onClick={save} disabled={busy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
          {busy ? "Saving…" : "Save pricing"}
        </button>
      </div>
    </Card>
  );
}

export function PromotionsTab() {
  return (
    <ComingSoon title="Promotions" icon={Tag}>
      Promo codes, referral rewards, and volume discounts are coming soon.
    </ComingSoon>
  );
}

export function ModeratorTab({ panelId, panelName }: { panelId: string; panelName: string }) {
  if (!VIRTUAL_MODERATOR_ENABLED) {
    return (
      <Card title={`Virtual Moderator · ${panelName}`} icon={Bot}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] px-2 py-1 rounded-full fp-gold-soft-bg fp-gold">Coming soon</span>
        </div>
        <p className="fp-text-dim text-sm leading-relaxed">
          Innvil Virtual Moderator — an AI community moderator/member for your Telegram groups and channels — is in
          active development. It&apos;ll bring reactive natural chatter, moderation, proactive engagement, and a
          7-day free trial when it launches. Nothing to set up yet.
        </p>
      </Card>
    );
  }

  return <ModeratorTabContent panelId={panelId} panelName={panelName} />;
}

function ModeratorTabContent({ panelId, panelName }: { panelId: string; panelName: string }) {
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [moderators, setModerators] = React.useState<VirtualModeratorRow[]>([]);
  const [planInfo, setPlanInfo] = React.useState<ModeratorPlanInfo | null>(null);
  const [name, setName] = React.useState("");
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  const refresh = React.useCallback(async () => {
    const [mods, plan] = await Promise.all([listVirtualModerators(panelId), getModeratorPlanInfo(panelId)]);
    setModerators(mods);
    setPlanInfo(plan);
  }, [panelId]);

  React.useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const create = async () => {
    setCreating(true); setMsg(null);
    const res = await createVirtualModerator(panelId, name);
    setCreating(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setName("");
    setMsg({ text: `${res.data.name} created.` });
    await refresh();
  };

  if (loading) return <Card title="Virtual Moderator" icon={Bot}><p className="fp-text-faint text-sm py-4 text-center">Loading&hellip;</p></Card>;

  return (
    <div className="space-y-4 max-w-3xl">
      <Card title={`Virtual Moderator · ${panelName}`} icon={Bot}>
        <p className="fp-text-dim text-sm mb-4 leading-relaxed">
          Foundation build in progress. A Virtual Moderator is a reusable identity you can later deploy to one or more
          Telegram communities &mdash; creating one here does not yet create a Telegram bot or connect a community; that
          lands with Telegram Managed Bot provisioning next.
        </p>

        {planInfo && !planInfo.offered && (
          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim mb-4">
            No Virtual Moderator plan is active on this panel yet. Contact Innvil to enable a tier
            (Basic/Standard/Premium/Pro) before deploying to a live community.
          </div>
        )}
        {planInfo?.offered && (
          <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim mb-4">
            Plan: <span className="fp-text capitalize">{planInfo.tier}</span> &middot;{" "}
            {planInfo.commercialMode === "commission" ? "Innvil-processed commission" : "Owner-rented access"} &middot;{" "}
            Capacity: {planInfo.maxCommunities} communit{planInfo.maxCommunities === 1 ? "y" : "ies"},{" "}
            {planInfo.maxActiveSlots} active mod slots.
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Moderator name, e.g. Mika"
            className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border"
          />
          <button onClick={create} disabled={creating || !name.trim()} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {creating ? "Creating&hellip;" : "Create"}
          </button>
        </div>
        {msg && <p className={`text-xs mt-3 flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</p>}

        <div className="mt-4 space-y-2">
          {moderators.length === 0 ? (
            <p className="text-xs fp-text-faint">No moderators yet.</p>
          ) : moderators.map((mod) => (
            <TelegramConnectRow key={mod.id} panelId={panelId} moderator={mod} onChanged={refresh} />
          ))}
        </div>
      </Card>
    </div>
  );
}

const RETRIABLE_PROVISIONING_STATUSES = new Set([
  "draft",
  "requires_retry",
  "cancelled",
  "username_unavailable",
  "telegram_creation_failed",
  "credential_setup_failed",
  "expired",
]);
const CONNECTED_PROVISIONING_STATUSES = new Set(["bot_ready", "community_setup_required", "active"]);

function TelegramConnectRow({
  panelId,
  moderator,
  onChanged,
}: {
  panelId: string;
  moderator: VirtualModeratorRow;
  onChanged: () => void | Promise<void>;
}) {
  const [status, setStatus] = React.useState(moderator.provisioningStatus);
  const [telegramUsername, setTelegramUsername] = React.useState(moderator.telegramUsername);
  const [lastError, setLastError] = React.useState(moderator.lastError);
  const [expanded, setExpanded] = React.useState(false);
  // Real editable value, not a placeholder — a placeholder here previously let
  // people believe a suggested username was already filled in when it wasn't,
  // silently falling back to a bare "<name>_bot" that could collide with an
  // unrelated existing bot.
  const [requestedUsername, setRequestedUsername] = React.useState(
    () => `${moderator.name.toLowerCase().replace(/[^a-z0-9_]/g, "")}_mod_bot`
  );
  const [busy, setBusy] = React.useState(false);
  const [rowMsg, setRowMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  React.useEffect(() => {
    setStatus(moderator.provisioningStatus);
    setTelegramUsername(moderator.telegramUsername);
    setLastError(moderator.lastError);
  }, [moderator.provisioningStatus, moderator.telegramUsername, moderator.lastError]);

  // Poll while waiting on Telegram — Innvil detects success asynchronously via
  // the Manager Bot's own webhook, there's no redirect back into this tab.
  React.useEffect(() => {
    if (status !== "telegram_confirmation_pending") return;
    const interval = setInterval(async () => {
      const next = await getModeratorProvisioning(panelId, moderator.id);
      if (!next) return;
      if (next.provisioningStatus !== status) {
        setStatus(next.provisioningStatus);
        setTelegramUsername(next.telegramUsername);
        setLastError(next.lastError);
        await onChanged();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [status, panelId, moderator.id, onChanged]);

  const startConnect = async () => {
    setBusy(true); setRowMsg(null);
    const res = await requestTelegramCreation(panelId, moderator.id, requestedUsername);
    setBusy(false);
    if (!res.ok) { setRowMsg({ text: res.error, error: true }); return; }
    setStatus("telegram_confirmation_pending");
    setExpanded(false);
    window.open(res.data.deepLink, "_blank", "noopener,noreferrer");
    setRowMsg({ text: `Opened Telegram for @${res.data.requestedUsername} — confirm creation there, then come back here.` });
  };

  const cancel = async () => {
    setBusy(true); setRowMsg(null);
    const res = await cancelTelegramProvisioning(panelId, moderator.id);
    setBusy(false);
    if (!res.ok) { setRowMsg({ text: res.error, error: true }); return; }
    setStatus("draft");
    setLastError(null);
    await onChanged();
  };

  const checkNow = async () => {
    setBusy(true);
    const next = await getModeratorProvisioning(panelId, moderator.id);
    setBusy(false);
    if (!next) return;
    setStatus(next.provisioningStatus);
    setTelegramUsername(next.telegramUsername);
    setLastError(next.lastError);
    if (next.provisioningStatus !== "telegram_confirmation_pending") await onChanged();
  };

  return (
    <div className="fp-panel-raised border fp-line-soft rounded-xl p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">{moderator.name}</p>
          <p className="text-xs fp-text-faint">
            {telegramUsername ? `@${telegramUsername}` : "No Telegram identity yet"} &middot; {status.replaceAll("_", " ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {CONNECTED_PROVISIONING_STATUSES.has(status) && (
            <span className="text-[11px] px-2 py-1 rounded-full fp-gold-soft-bg fp-gold">Telegram connected</span>
          )}
          {status === "telegram_confirmation_pending" && (
            <>
              <span className="text-[11px] px-2 py-1 rounded-full fp-line-soft fp-panel-raised fp-text-dim">Waiting on Telegram&hellip;</span>
              <button onClick={checkNow} disabled={busy} className="text-xs px-2.5 py-1.5 rounded-lg border fp-line-soft fp-panel-raised fp-text-dim hover:fp-text disabled:opacity-60">
                Check now
              </button>
              <button onClick={cancel} disabled={busy} className="text-xs px-2.5 py-1.5 rounded-lg border fp-line-soft fp-panel-raised fp-text-dim hover:fp-text disabled:opacity-60">
                Cancel
              </button>
            </>
          )}
          {RETRIABLE_PROVISIONING_STATUSES.has(status) && !expanded && (
            <button onClick={() => setExpanded(true)} className="text-xs px-2.5 py-1.5 rounded-lg fp-btn-primary font-semibold">
              {status === "draft" ? "Connect Telegram" : "Retry"}
            </button>
          )}
        </div>
      </div>

      {lastError && <p className="text-xs text-red-400 mt-2">{lastError}</p>}

      {expanded && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={requestedUsername}
            onChange={(e) => setRequestedUsername(e.target.value)}
            placeholder="Telegram username for this bot"
            className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border"
          />
          <button onClick={startConnect} disabled={busy} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60">
            {busy ? "Opening&hellip;" : "Create with Telegram"}
          </button>
          <button onClick={() => setExpanded(false)} className="text-xs px-2.5 py-2 rounded-lg border fp-line-soft fp-panel-raised fp-text-dim hover:fp-text">
            Cancel
          </button>
        </div>
      )}

      {rowMsg && <p className={`text-xs mt-2 ${rowMsg.error ? "text-red-400" : "fp-safe"}`}>{rowMsg.text}</p>}
    </div>
  );
}
