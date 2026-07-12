"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Circle, CheckCircle2, Clock, X, FileText, Lock, AlertTriangle, Wrench, History,
  Image as ImageIcon, Type, Globe, RefreshCw, Wifi, Sparkles, Sliders, Tag,
  ChevronDown, ShieldCheck, ListOrdered, Users, CreditCard, KeyRound, Bell,
  MessageSquare, Bot, Plus, Trash2, Search, Download, LucideIcon,
} from "lucide-react";
import {
  Card, StatCard, FloorLedger, StatusBadge, StatusDropdown, Toggle, Pill,
} from "@/src/components/ui";
import {
  PANEL_STATUSES, categoriesData, PanelStatus,
} from "@/src/data/constants";
import { Panel, CustomerRow } from "@/src/types";
import type { ProviderRow, MarkupKind, OrderStatus } from "@/src/types/db";
import type { ProviderServiceDTO } from "@/src/lib/providers";
import {
  listProviders, createProvider, testProviderConnection,
  fetchProviderBalance, deleteProvider,
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
  type PanelCustomerVM,
} from "@/src/lib/actions/customers";
import {
  getPaymentsMeta, connectGateway, disconnectGateway, setPanelCurrency, type PaymentsMeta,
} from "@/src/lib/actions/payments";
import { getPanelBranding, updatePanelBranding, type LandingSection } from "@/src/lib/actions/panels";
import {
  listPanelOrders, getPanelOverview, getPanelCurrency,
  resendOrder, requestRefill, requestCancel, markOrderCompleted, refundOrder,
  type AdminOrderVM, type PanelOverview,
} from "@/src/lib/actions/admin-orders";
import { syncOrdersNow } from "@/src/lib/actions/orders";
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
    const raw = window.sessionStorage.getItem(getAdminCacheKey(panelId, section));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeAdminCache<T>(panelId: string, section: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getAdminCacheKey(panelId, section), JSON.stringify(value));
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
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  completed: "Completed", processing: "Processing", in_progress: "In progress",
  pending: "Pending", partial: "Partial", canceled: "Canceled",
  failed: "Failed", refunded: "Refunded",
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
                  <td className="py-2.5 fp-mono fp-text-dim">#{o.shortId}</td>
                  <td className="py-2.5">{o.serviceName}</td>
                  <td className="py-2.5 fp-text-dim">{o.customerEmail ?? "—"}</td>
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

export function StatusTab({
  panelStatus,
  setPanelStatus,
}: {
  panelStatus: PanelStatus;
  setPanelStatus: (s: PanelStatus) => void;
}) {
  const currentStatusConfig = PANEL_STATUSES[panelStatus] || PANEL_STATUSES.live;
  return (
    <div className="space-y-6 max-w-3xl">
      <Card title="Panel Status" icon={Circle}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={panelStatus} />
            <span className="text-sm fp-text-dim">Current status</span>
          </div>
          <StatusDropdown currentStatus={panelStatus} onChange={setPanelStatus} />
        </div>
        <p className="text-sm fp-text-dim leading-relaxed">{currentStatusConfig.description}</p>
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
        <div className="space-y-3">
          {[
            { color: "#6FCF97", label: "Changed to Live", time: "2 hours ago" },
            { color: "#C9A574", label: "Changed to Inactive Mode", time: "Yesterday" },
            { color: "#9497A3", label: "Panel created as Draft", time: "3 days ago" },
          ].map((h, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: h.color }} />
                <span>{h.label}</span>
              </div>
              <span className="fp-text-faint text-xs fp-mono">{h.time}</span>
            </div>
          ))}
        </div>
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
    });
  }, [panel.id, realPanel]);

  const save = async () => {
    if (!realPanel) { setMsg({ text: "Save this panel first.", error: true }); return; }
    setBusy(true); setMsg(null);
    const res = await updatePanelBranding(panel.id, { name, theme, logoUrl, accent, headline, description, favicon, sections });
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
          initial={{ name, theme, logoUrl, accent, headline, description, favicon, sections }}
          onClose={() => setStudioFull(false)}
          onSaved={(vv) => {
            setName(vv.name); setTheme(vv.theme); setLogoUrl(vv.logoUrl);
            setAccent(vv.accent); setHeadline(vv.headline); setDescription(vv.description);
            setFavicon(vv.favicon); setSections(vv.sections);
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
            <Sparkles size={14} /> Open full Design Studio
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

export function DomainTab({ panel }: { panel: Panel }) {
  return (
    <Card
      title="Domain"
      icon={Globe}
      right={<span className="text-xs fp-gold-soft-bg fp-gold px-2.5 py-1 rounded-full">Custom domains coming soon</span>}
    >
      <div className="flex items-center justify-between fp-panel-raised border fp-line-soft rounded-xl p-4 mb-4">
        <div>
          <p className="text-sm fp-mono">{panel.subdomain}</p>
          <p className="fp-text-faint text-xs mt-0.5">Included subdomain — live now</p>
        </div>
        <Pill tone="safe" icon={CheckCircle2}>Active</Pill>
      </div>
      <p className="fp-text-dim text-sm leading-relaxed">
        Connecting your own custom domain — with automatic SSL and DNS verification — is coming soon.
        Until then, your panel is fully live on its included subdomain above.
      </p>
    </Card>
  );
}

type RowState = { busy?: boolean; msg?: string; error?: boolean };
const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function ProvidersTab({ panelId }: { panelId: string }) {
  const realPanel = isUuid(panelId);
  const [providers, setProviders] = useState<ProviderRow[] | null>(() =>
    realPanel ? readAdminCache<ProviderRow[]>(panelId, "providers") : []
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", apiUrl: "", apiKey: "", currency: "USD" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const providersRef = useRef<ProviderRow[] | null>(providers);

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
          <button
            onClick={() => { setShowForm((v) => !v); setFormError(null); }}
            disabled={!realPanel}
            className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={13} /> Add provider
          </button>
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
                      <td className="py-3 fp-mono fp-text-dim text-xs">
                        {p.balance != null ? `${p.balance} ${p.currency}` : "—"}
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2 text-xs fp-text-dim flex-wrap items-center">
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

  // Import panel
  const [importOpen, setImportOpen] = useState(false);
  const [impProvider, setImpProvider] = useState("");
  const [provCatalog, setProvCatalog] = useState<ProviderServiceDTO[] | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [markupKind, setMarkupKind] = useState<MarkupKind>("percent");
  const [markupValue, setMarkupValue] = useState("20");
  const [search, setSearch] = useState("");
  const catalogRef = useRef<CatalogPlatform[] | null>(catalog);
  const providersRef = useRef<ProviderRow[]>(providers);

  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  useEffect(() => { providersRef.current = providers; }, [providers]);

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
    setImpProvider(provId);
    setProvCatalog(null);
    setSelected(new Set());
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
    const res = await importServices(impProvider, {
      providerServiceIds: [...selected],
      markupKind,
      markupValue: Number(markupValue) || 0,
    });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `Imported ${res.data.imported} service(s)${res.data.skipped ? `, skipped ${res.data.skipped} already imported` : ""}.` });
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
    if (!window.confirm(`Delete "${s.name}"? This can't be undone.`)) return;
    const res = await deleteService(s.id);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    refresh();
  };

  // Delete a whole category (platform or sub) + every service in it. Falls back
  // to deleting by service ids for id-less groups (Uncategorized/legacy flat).
  const doDeleteCategory = async (id: string | null, name: string, serviceIds: string[]) => {
    if (!window.confirm(`Delete "${name}" and its ${serviceIds.length} service(s)? This can't be undone.`)) return;
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
    if (!window.confirm(`Delete ${sel.size} selected service(s)? This can't be undone.`)) return;
    runBulk(() => bulkDeleteServices([...sel]), (n) => `Deleted ${n} service(s).`);
  };
  const bulkMarkup = () => runBulk(() => bulkSetMarkup([...sel], bulkKind, Number(bulkVal) || 0), (n) => `Updated markup on ${n} service(s).`);

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
              <p className="text-xs fp-text-dim">Applied to all selected on import; editable per service later. Categories auto-created.</p>
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
                  return (
                    <label key={id} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${done ? "opacity-50" : "cursor-pointer hover:fp-panel-raised"}`}>
                      <input type="checkbox" disabled={done} checked={selected.has(id)} onChange={() => toggleSel(id)} className="accent-[#C9A574]" />
                      <span className="flex-1 min-w-0">
                        <span className="truncate block">{s.name}</span>
                        <span className="fp-text-faint text-[11px] fp-mono">#{id} · {s.category} · min {s.min} · max {s.max}</span>
                      </span>
                      <span className="fp-mono text-xs fp-text-dim shrink-0">${Number(s.rate).toFixed(2)}/1k{done ? " · imported" : ""}</span>
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
        {catalog && catalog.length > 0 && (
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
        ) : catalog.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">No services yet. Import them from a connected provider — categories are created automatically.</p>
        ) : (
          <div className="space-y-2">
            {catalog.map((p) => {
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
  { k: "canceled", label: "Canceled" },
  { k: "refunded", label: "Refunded" },
  { k: "failed", label: "Failed" },
];

export function OrdersTab({ panelId }: { panelId: string }) {
  const realPanel = isUuid(panelId);
  const [rows, setRows] = useState<AdminOrderVM[] | null>(() =>
    realPanel ? readAdminCache<AdminOrderVM[]>(panelId, "orders") : []
  );
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!realPanel) return;
    const [list, cur] = await Promise.all([listPanelOrders(panelId), getPanelCurrency(panelId)]);
    setRows(list);
    setCurrency(cur);
    writeAdminCache(panelId, "orders", list);
  }, [panelId, realPanel]);

  useEffect(() => { load(); }, [load]);

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
        (o.customerEmail ?? "").toLowerCase().includes(needle) ||
        o.link.toLowerCase().includes(needle)
      );
    });
  }, [rows, status, q]);

  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusyId(id); setMsg(null);
    const res = await fn();
    if (!res.ok) { setMsg({ text: res.error ?? "Action failed.", error: true }); setBusyId(null); return; }
    setMsg({ text: okMsg });
    await load();
    setBusyId(null);
  };

  const doRefund = async (o: AdminOrderVM) => {
    const input = window.prompt(`Refund amount for order #${o.shortId} (max ${o.charge}). Leave blank for full refund.`, "");
    if (input === null) return;
    const amount = input.trim() === "" ? undefined : Number(input);
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) { setMsg({ text: "Enter a valid amount.", error: true }); return; }
    await act(o.id, () => refundOrder(o.id, amount), "Refund issued.");
  };

  const syncNow = async () => {
    setSyncing(true); setMsg(null);
    const res = await syncOrdersNow(panelId);
    if (!res.ok) setMsg({ text: res.error, error: true });
    else { setMsg({ text: `Synced ${res.checked} order(s), ${res.updated} updated.` }); await load(); }
    setSyncing(false);
  };

  if (!realPanel) {
    return (
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-6 text-center fp-text-dim text-sm">
        Save this panel to manage real orders here.
      </div>
    );
  }

  return (
    <Card
      title="Orders"
      icon={ListOrdered}
      right={
        <button onClick={syncNow} disabled={syncing} className="fp-panel-raised border fp-line-soft text-xs px-3 py-1.5 rounded-lg fp-text-dim hover:fp-text flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync statuses"}
        </button>
      }
    >
      {msg && <p className={`text-xs mb-3 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</p>}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 overflow-x-auto">
          {ORDER_FILTERS.map((f) => (
            <button
              key={f.k}
              onClick={() => setStatus(f.k)}
              className={`text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap border ${status === f.k ? "fp-gold-border fp-gold-soft-bg fp-gold" : "fp-line-soft fp-panel-raised fp-text-dim"}`}
            >
              {f.label}
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

      {rows === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">
          {rows.length === 0 ? "No orders yet. They'll appear here as customers order." : "No orders match this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                <th className="py-2 font-normal">ID</th>
                <th className="py-2 font-normal">Service</th>
                <th className="py-2 font-normal">Customer</th>
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
                      <td className="py-3 fp-mono fp-text-dim">#{o.shortId}</td>
                      <td className="py-3">{o.serviceName}</td>
                      <td className="py-3 fp-text-dim">{o.customerEmail ?? "—"}</td>
                      <td className="py-3 text-right fp-mono">{o.quantity.toLocaleString()}</td>
                      <td className="py-3 text-right fp-mono">{fmt(o.charge)}</td>
                      <td className="py-3"><OrderStatusPill status={o.status} /></td>
                      <td className="py-3 text-right">
                        <button onClick={() => setExpanded(open ? null : o.id)} className="fp-gold text-xs">
                          {open ? "Hide" : "Manage"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="pb-4">
                          <div className="fp-panel-raised border fp-line-soft rounded-lg p-4 space-y-3 text-xs">
                            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                              <p><span className="fp-text-faint">Link:</span> <span className="fp-mono break-all">{o.link}</span></p>
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
                              {o.status !== "refunded" && (
                                <button disabled={busy} onClick={() => doRefund(o)} className="fp-panel border border-red-500/30 rounded px-2.5 py-1.5 text-red-400 hover:opacity-80 disabled:opacity-50">Refund</button>
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
      )}
    </Card>
  );
}

const CUSTOMER_STATUS_TONE: Record<string, string> = {
  active: "fp-safe-soft-bg fp-safe",
  banned: "bg-red-500/10 text-red-400",
  restricted: "fp-gold-soft-bg fp-gold",
};

export function CustomersTab({ panel }: { panel: Panel; onView?: (c: CustomerRow) => void }) {
  const realPanel = isUuid(panel.id);
  const [rows, setRows] = useState<PanelCustomerVM[] | null>(() =>
    realPanel ? readAdminCache<PanelCustomerVM[]>(panel.id, "customers") : []
  );
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
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

  const openAdjust = (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    setAmount(""); setReason(""); setMsg(null);
  };
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
                <th className="py-2 font-normal text-right">Balance actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <React.Fragment key={c.id}>
                  <tr className="border-b fp-line-soft last:border-0">
                    <td className="py-3 pr-3">{c.email ?? <span className="fp-text-faint fp-mono">{c.userId.slice(0, 8)}</span>}</td>
                    <td className="py-3 fp-mono fp-gold">${c.balance.toFixed(2)}</td>
                    <td className="py-3 fp-mono">{c.orders}</td>
                    <td className="py-3 fp-mono">${c.spent.toFixed(2)}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full ${CUSTOMER_STATUS_TONE[c.status] ?? "fp-panel-raised fp-text-dim"}`}>{c.status}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => openAdjust(c.id)} className="text-xs fp-gold border fp-line-soft rounded-lg px-3 py-1.5 hover:fp-gold-border">Adjust</button>
                        <button onClick={() => toggleBan(c)} className={`text-xs rounded-lg px-3 py-1.5 border ${c.status === "banned" ? "fp-safe border-[rgba(126,200,140,0.3)]" : "text-red-400 border-red-500/30"}`}>
                          {c.status === "banned" ? "Unban" : "Ban"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {openId === c.id && (
                    <tr className="border-b fp-line-soft">
                      <td colSpan={6} className="py-3">
                        <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 flex flex-wrap items-end gap-3">
                          <div>
                            <label className="fp-text-dim text-[10px] fp-mono uppercase">Amount ($)</label>
                            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className={`${inputCls} fp-mono w-32 mt-1 block`} />
                          </div>
                          <div className="flex-1 min-w-[160px]">
                            <label className="fp-text-dim text-[10px] fp-mono uppercase">Reason (optional)</label>
                            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. bonus, manual top-up" className={`${inputCls} w-full mt-1 block`} />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => adjust(c.id, 1)} disabled={busy} className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Credit +</button>
                            <button onClick={() => adjust(c.id, -1)} disabled={busy} className="text-xs font-semibold px-4 py-2 rounded-lg border border-red-500/30 text-red-400 disabled:opacity-50">Debit −</button>
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
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

  const openForm = (id: string) => { setOpenId((p) => (p === id ? null : id)); setValues({}); setMsg(null); };
  const save = async (id: string, label: string) => {
    setBusy(true); setMsg(null);
    const res = await connectGateway(panelId, id, values);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: `${label} connected.` });
    setOpenId(null); setValues({});
    refresh();
  };
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Disconnect ${label}? Customers won't be able to pay with it.`)) return;
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
              return (
                <div key={c.id} className="border fp-line-soft rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 fp-panel-raised">
                    <div className="min-w-0">
                      <p className="text-sm font-medium flex items-center gap-2">
                        {c.label}
                        {conn && <span className="text-[10px] fp-safe-soft-bg fp-safe px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle2 size={10} /> Connected</span>}
                      </p>
                      <p className="fp-text-faint text-xs mt-0.5">{c.note}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!c.available ? (
                        <span className="text-xs fp-text-faint px-2 py-1">Coming soon</span>
                      ) : conn ? (
                        <>
                          <button onClick={() => openForm(c.id)} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 hover:fp-gold-border">Edit</button>
                          <button onClick={() => remove(c.id, c.label)} disabled={busy} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 disabled:opacity-50">Disconnect</button>
                        </>
                      ) : (
                        <button onClick={() => openForm(c.id)} className="fp-btn-primary text-xs font-semibold px-4 py-1.5 rounded-lg">Connect</button>
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
                            value={values[f.key] ?? ""}
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
    </div>
  );
}

export function CustomerApiTab() {
  return (
    <ComingSoon title="Customer API" icon={KeyRound}>
      A programmatic API for your panel&apos;s customers to place orders — with per-key rate limits,
      IP allow-lists, and usage logs — is coming soon. This is separate from the provider API you
      connect under Providers &amp; API, which is live now.
    </ComingSoon>
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

export function NotificationsTab() {
  return (
    <ComingSoon title="Notifications" icon={Bell}>
      Owner and customer email notifications (new orders, failed orders, deposits, provider errors,
      and more) are coming soon.
    </ComingSoon>
  );
}

export function SupportTab({ panelId }: { panelId: string }) {
  return <SupportInbox panelId={panelId} />;
}

export function AutomationTab() {
  return (
    <Card
      title="Automator add-on"
      icon={Bot}
      right={<span className="text-xs fp-gold-soft-bg fp-gold px-2.5 py-1 rounded-full">Coming soon</span>}
    >
      <p className="fp-text-dim text-sm mb-4">
        Mass &amp; automatic order fulfillment — paste or upload many links, auto-detect the platform,
        and fan each one out to the right services from your presets. You&apos;ll be able to offer it
        as a paid upgrade to your own customers.
      </p>
      <p className="fp-text-faint text-sm">
        The Automator ships after the core owner, admin, super-admin, and customer tools are complete.
      </p>
      <button disabled className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg text-sm mt-4 opacity-50 cursor-not-allowed">
        Coming soon
      </button>
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
