"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, LayoutGrid, CreditCard, CheckCircle2, AlertTriangle, Lock, ArrowLeft, Wallet,
  PlayCircle, Trash2, LifeBuoy, Newspaper, PenLine, Plus, Eye, EyeOff, RefreshCw, ExternalLink, Tag,
} from "lucide-react";
import { Card, StatCard, Pill } from "@/src/components/ui";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import {
  getPlatformOverview, listPanelsForSuperAdmin, adjustPanelBalance, setPanelCommissionRate, setPanelAiAddon, setPanelPlan,
  getOrderSyncHealth, type PlatformOverview, type SuperAdminPanelVM, type OrderSyncHealth,
} from "@/src/lib/actions/superadmin";
import { commissionBracketRate } from "@/src/lib/money";
import { getLandingVideo, setLandingVideo, getSupportEmail, setSupportEmail } from "@/src/lib/actions/platform-settings";
import {
  listPlatformSupportMessages,
  setPlatformSupportStatus,
  listInnvilOwnerContacts,
  sendSuperAdminOwnerMessage,
  runDraftOnboardingSweep,
  type PlatformSupportMessage,
  type InnvilOwnerContact,
} from "@/src/lib/actions/platform-support";
import { toVideoEmbed } from "@/src/lib/video";
import {
  getPlatformPaymentsMeta, connectPlatformGateway, disconnectPlatformGateway,
  getPlatformTopupDiscountDefaults, setPlatformTopupDiscountDefaults,
  type PlatformGatewayMeta, type PaymentDiscountCategory,
} from "@/src/lib/actions/platform-payments";
import {
  listAdminPosts, listTopics, addTopic, deleteTopic, generateDraftNow,
  publishPost, unpublishPost, deletePost, updatePostMeta,
  type AdminBlogPost, type AdminBlogTopic,
} from "@/src/lib/actions/blog-admin";
import {
  listVisiblePaymentsForPanel,
  listArchivedPaymentsForPanel,
  archiveSelectedPayments,
  restoreSelectedPayments,
  type ArchivedPaymentRow,
} from "@/src/lib/actions/payment-archive";
import { PAYMENT_ARCHIVE_CONFIRM_COPY } from "@/src/lib/payments/payment-archive-copy";
import {
  isBulkArchiveDisabled,
  isBulkRestoreDisabled,
  shouldClearSelection,
  type PaymentArchiveSelectionScope,
} from "@/src/lib/payments/payment-archive-selection";
import {
  deriveArchiveRenderState,
  filterPaymentArchiveRows,
  maskPanelIdForLog,
  shouldReloadAfterBulkMutation,
  shouldReloadForPanelChange,
  shouldReloadForViewChange,
} from "@/src/lib/payments/payment-archive-view";
import { ArticleBody } from "@/src/components/blog/ArticleBody";
import { BlogReview } from "./BlogReview";
import { DesignPricingAdmin } from "./DesignPricingAdmin";

const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-1.5 outline-none focus:fp-gold-border";

/* ---------------- Overview ---------------- */
function OverviewTab() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [syncHealth, setSyncHealth] = useState<OrderSyncHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([getPlatformOverview(), getOrderSyncHealth()])
      .then(([next, health]) => {
        if (!alive) return;
        setData(next);
        setSyncHealth(health);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Could not load overview.");
      });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <Card title="Overview" icon={LayoutGrid}>
        <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Panels" value={data ? String(data.panels) : "—"} tone="gold" />
        <StatCard label="Live panels" value={data ? String(data.livePanels) : "—"} />
        <StatCard label="Panel owners" value={data ? String(data.owners) : "—"} />
        <StatCard label="Customers" value={data ? String(data.customers) : "—"} />
      </div>
      <Card title="Order Auto-sync" icon={RefreshCw}>
        {!syncHealth?.lastRunAt ? (
          <p className="fp-text-faint text-sm">No auto-sync runs logged yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <span className="fp-text-faint">Last run:</span>
              <span>{new Date(syncHealth.lastRunAt).toLocaleString()}</span>
              {syncHealth.lastOk === true ? (
                <Pill tone="safe" icon={CheckCircle2}>OK</Pill>
              ) : syncHealth.lastOk === false ? (
                <Pill tone="danger" icon={AlertTriangle}>Failed</Pill>
              ) : (
                <Pill tone="muted">Unknown</Pill>
              )}
            </p>
            <p className="fp-text-dim text-xs fp-mono">
              Panels {syncHealth.lastPanels} · Checked {syncHealth.lastChecked} · Updated {syncHealth.lastUpdated}
            </p>
            {syncHealth.lastError && (
              <p className="text-red-400 text-xs">{syncHealth.lastError}</p>
            )}
            {syncHealth.lastSuccessAt && (
              <p className="fp-text-faint text-xs">Last successful run: {new Date(syncHealth.lastSuccessAt).toLocaleString()}</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Platform payments ---------------- */
function GatewayCard({ g, onSaved }: { g: PlatformGatewayMeta; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await connectPlatformGateway(g.id, values);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Saved." });
    setValues({});
    onSaved();
  };

  const disconnect = async () => {
    setBusy(true); setMsg(null);
    const res = await disconnectPlatformGateway(g.id);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    onSaved();
  };

  return (
    <div className="fp-panel border fp-line rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg fp-gold-soft-bg fp-gold flex items-center justify-center"><CreditCard size={16} /></span>
          <div>
            <p className="text-sm font-medium">{g.label}</p>
            <p className="fp-text-faint text-xs">{g.note}</p>
          </div>
        </div>
        {g.connected
          ? <Pill tone="safe" icon={CheckCircle2}>Connected</Pill>
          : <Pill tone="muted">Not connected</Pill>}
      </div>

      <button onClick={() => setOpen((o) => !o)} className="fp-gold text-xs mt-4">
        {open ? "Hide" : g.connected ? "Update credentials" : "Connect"}
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {g.fields.map((f) => (
            <div key={f.key}>
              <label className="fp-text-dim text-xs fp-mono uppercase">{f.label}{f.optional ? " (optional)" : ""}</label>
              <input
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? (f.secret ? "" : g.config[f.key] ?? "")}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.secret && g.connected ? "•••••••• (leave blank to keep)" : f.placeholder}
                className={`${inputCls} ${f.secret ? "fp-mono" : ""}`}
                autoComplete="off"
              />
              {f.help && <p className="fp-text-faint text-[11px] mt-1">{f.help}</p>}
            </div>
          ))}
          {msg && <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
              {busy ? "Saving…" : "Save"}
            </button>
            {g.connected && (
              <button onClick={disconnect} disabled={busy} className="text-xs text-red-400 px-3 py-2 rounded-lg border border-red-500/30">Disconnect</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentsTab() {
  const [meta, setMeta] = useState<PlatformGatewayMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discounts, setDiscounts] = useState<Record<PaymentDiscountCategory, Array<{ minAmount: string; discountPct: string }>>>({
    card: [],
    ewallet: [],
    crypto: [],
    bank: [],
  });
  const [savingDiscounts, setSavingDiscounts] = useState(false);
  const [discountMsg, setDiscountMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const load = () => {
    setError(null);
    return Promise.all([getPlatformPaymentsMeta(), getPlatformTopupDiscountDefaults()])
      .then(([nextMeta, nextDiscounts]) => {
        setMeta(nextMeta);
        setDiscounts({
          card: nextDiscounts.card.map((r) => ({ minAmount: String(r.minAmount), discountPct: String(r.discountPct) })),
          ewallet: nextDiscounts.ewallet.map((r) => ({ minAmount: String(r.minAmount), discountPct: String(r.discountPct) })),
          crypto: nextDiscounts.crypto.map((r) => ({ minAmount: String(r.minAmount), discountPct: String(r.discountPct) })),
          bank: nextDiscounts.bank.map((r) => ({ minAmount: String(r.minAmount), discountPct: String(r.discountPct) })),
        });
        setError(null);
      })
      .catch((e) => {
        setMeta([]);
        setError(e instanceof Error ? e.message : "Could not load platform payments.");
      });
  };
  useEffect(() => { load(); }, []);

  const saveDiscounts = async () => {
    setSavingDiscounts(true);
    setDiscountMsg(null);
    const res = await setPlatformTopupDiscountDefaults(discounts);
    setSavingDiscounts(false);
    if (!res.ok) {
      setDiscountMsg({ text: res.error, error: true });
      return;
    }
    setDiscountMsg({ text: "Global top-up discounts saved." });
    load();
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="fp-text-dim text-sm">
        These are the methods <span className="fp-text">panel owners</span> use to pay Innvil (top up their
        commission balance). Credentials are encrypted and never leave the server. Minimum owner top-up is
        <span className="fp-text"> $5</span>, and the first top-up per panel is fixed at
        <span className="fp-text"> $10</span>. Binance Pay is coming later.
      </p>
      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <p className="text-sm font-medium">Global customer top-up discounts</p>
        <p className="fp-text-faint text-xs">
          Add tier rules per category (example: if top-up is 100+, give 5%). These apply platform-wide unless a panel owner overrides per method.
        </p>
        <div className="space-y-3">
          {([
            ["card", "Card"],
            ["ewallet", "E-wallet"],
            ["crypto", "Crypto"],
            ["bank", "Bank"],
          ] as Array<[PaymentDiscountCategory, string]>).map(([k, label]) => (
            <div key={k} className="fp-panel-raised border fp-line-soft rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="fp-text-dim text-xs fp-mono uppercase">{label} tiers</label>
                <button
                  onClick={() => setDiscounts((prev) => ({
                    ...prev,
                    [k]: [...prev[k], { minAmount: "", discountPct: "" }],
                  }))}
                  className="text-xs fp-gold border fp-line-soft rounded-lg px-2.5 py-1"
                >
                  Add tier
                </button>
              </div>
              {discounts[k].length === 0 ? (
                <p className="fp-text-faint text-xs">No default tiers. Panel owners can still add their own per-method tiers.</p>
              ) : (
                <div className="space-y-2">
                  {discounts[k].map((r, idx) => (
                    <div key={`${k}-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        value={r.minAmount}
                        onChange={(e) => setDiscounts((prev) => ({
                          ...prev,
                          [k]: prev[k].map((row, i) => (i === idx ? { ...row, minAmount: e.target.value } : row)),
                        }))}
                        placeholder="Min top-up amount"
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputCls}
                      />
                      <input
                        value={r.discountPct}
                        onChange={(e) => setDiscounts((prev) => ({
                          ...prev,
                          [k]: prev[k].map((row, i) => (i === idx ? { ...row, discountPct: e.target.value } : row)),
                        }))}
                        placeholder="Discount %"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className={inputCls}
                      />
                      <button
                        onClick={() => setDiscounts((prev) => ({
                          ...prev,
                          [k]: prev[k].filter((_, i) => i !== idx),
                        }))}
                        className="text-xs text-red-400 border border-red-500/30 rounded-lg px-2.5"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {discountMsg && (
          <p className={`text-xs ${discountMsg.error ? "text-red-400" : "fp-safe"}`}>{discountMsg.text}</p>
        )}
        <button onClick={saveDiscounts} disabled={savingDiscounts} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
          {savingDiscounts ? "Saving…" : "Save discounts"}
        </button>
      </div>
      {meta === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : (
        <>
          {error && (
            <div className="fp-panel border border-red-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>
              <button onClick={load} className="text-xs fp-gold">Retry</button>
            </div>
          )}
          <div className="grid gap-4">
            {meta.map((g) => <GatewayCard key={g.id} g={g} onSaved={load} />)}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Panel management ---------------- */
function PanelsTab() {
  const [rows, setRows] = useState<SuperAdminPanelVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [amountById, setAmountById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [rateById, setRateById] = useState<Record<string, string>>({});

  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  const load = () => {
    setError(null);
    return listPanelsForSuperAdmin()
      .then((next) => {
        setRows(next);
        setError(null);
      })
      .catch((e) => {
        setRows([]);
        setError(e instanceof Error ? e.message : "Could not load panels.");
      });
  };

  useEffect(() => { load(); }, []);

  const apply = async (panelId: string, sign: 1 | -1) => {
    setNotice(null);
    setError(null);
    const raw = (amountById[panelId] ?? "").trim();
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid amount greater than 0.");
      return;
    }

    const key = `${panelId}:${sign}`;
    setBusyKey(key);
    const reason = reasonById[panelId] ?? "";
    const res = await adjustPanelBalance(panelId, sign * amount, reason);
    setBusyKey(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }

    setRows((prev) => (prev ?? []).map((r) => (r.id === panelId ? { ...r, balance: res.data.balance } : r)));
    setAmountById((prev) => ({ ...prev, [panelId]: "" }));
    setNotice(`Updated balance for panel ${panelId.slice(0, 8)}.`);
  };

  const toggleAi = async (panelId: string, next: boolean) => {
    setNotice(null);
    setError(null);
    setBusyKey(`${panelId}:ai`);
    const res = await setPanelAiAddon(panelId, next);
    setBusyKey(null);
    if (!res.ok) { setError(res.error); return; }
    setRows((prev) => (prev ?? []).map((r) => (r.id === panelId ? { ...r, aiSupport: res.data.enabled } : r)));
    setNotice(`AI support ${res.data.enabled ? "enabled" : "disabled"} for panel ${panelId.slice(0, 8)}.`);
  };

  const applyPlan = async (panelId: string, tier: "" | "pro" | "business" | "business_plus") => {
    setNotice(null); setError(null);
    setBusyKey(`${panelId}:plan`);
    const res = await setPanelPlan(panelId, tier === "" ? null : tier);
    setBusyKey(null);
    if (!res.ok) { setError(res.error); return; }
    setRows((prev) => (prev ?? []).map((r) => (r.id === panelId ? { ...r, planTier: res.data.tier } : r)));
    setNotice(`Plan set to ${res.data.tier ?? "Free"} for panel ${panelId.slice(0, 8)}.`);
  };

  const applyRate = async (panelId: string) => {
    setNotice(null);
    setError(null);
    const pct = Number((rateById[panelId] ?? "").trim());
    if (!Number.isFinite(pct) || pct < 1 || pct > 5) {
      setError("Commission must be between 1% and 5%.");
      return;
    }
    setBusyKey(`${panelId}:rate`);
    const res = await setPanelCommissionRate(panelId, pct / 100);
    setBusyKey(null);
    if (!res.ok) { setError(res.error); return; }
    setRows((prev) => (prev ?? []).map((r) => (r.id === panelId ? { ...r, commissionRate: res.data.rate } : r)));
    setRateById((prev) => ({ ...prev, [panelId]: "" }));
    setNotice(`Set commission to ${(res.data.rate * 100).toFixed(0)}% for panel ${panelId.slice(0, 8)}.`);
  };

  return (
    <div className="space-y-5">
      <p className="fp-text-dim text-sm">
        Manage panel balances and commission rates. Credits, debits and rate changes are audit-logged.
      </p>
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim">
        <span className="fp-text">Volume-discount brackets</span> (per panel, by completed orders/day):
        1k → 4% · 2.5k → 3% · 5k → 2% · 10k → 1%. Innvil never takes more than <span className="fp-gold">$100/panel/day</span>.
      </div>
      {notice && <p className="text-xs fp-safe flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

      {rows === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">No panels found.</p>
      ) : (
        <div className="fp-panel border fp-line rounded-2xl p-4 overflow-x-auto">
          <table className="w-full min-w-[1400px] text-sm">
            <thead>
              <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                <th className="py-2 font-normal">Panel</th>
                <th className="py-2 font-normal">Owner</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal text-right">Innvil balance</th>
                <th className="py-2 font-normal">Commission</th>
                <th className="py-2 font-normal">AI support</th>
                <th className="py-2 font-normal">Plan</th>
                <th className="py-2 font-normal">Amount</th>
                <th className="py-2 font-normal">Reason</th>
                <th className="py-2 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b fp-line-soft last:border-0">
                  <td className="py-2.5">
                    <p className="font-medium">{r.name}</p>
                    <p className="fp-text-faint text-xs fp-mono">{r.subdomain}.innvil.cloud</p>
                  </td>
                  <td className="py-2.5 fp-text-dim">{r.ownerEmail ?? r.ownerId.slice(0, 8)}</td>
                  <td className="py-2.5"><Pill tone={r.status === "live" ? "safe" : "muted"}>{r.status}</Pill></td>
                  <td className="py-2.5 text-right fp-mono fp-gold">{fmt(r.balance)}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="fp-mono text-xs fp-gold w-9">{(r.commissionRate * 100).toFixed(0)}%</span>
                      <input
                        value={rateById[r.id] ?? ""}
                        onChange={(e) => setRateById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="%"
                        inputMode="decimal"
                        className="w-12 fp-panel-raised border fp-line-soft rounded-lg px-2 py-1.5 text-xs fp-mono outline-none focus:fp-gold-border"
                      />
                      <button
                        onClick={() => applyRate(r.id)}
                        disabled={busyKey !== null}
                        className="text-xs fp-gold-soft-bg fp-gold px-2 py-1.5 rounded-lg disabled:opacity-60"
                      >
                        Set
                      </button>
                    </div>
                    <p className="fp-text-faint text-[11px] fp-mono mt-1">
                      {r.ordersToday.toLocaleString()}/day → suggests {(commissionBracketRate(r.ordersToday) * 100).toFixed(0)}%
                    </p>
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => toggleAi(r.id, !r.aiSupport)}
                      disabled={busyKey !== null}
                      className={`text-xs px-2.5 py-1.5 rounded-lg disabled:opacity-60 ${r.aiSupport ? "fp-safe-soft-bg fp-safe" : "fp-panel-raised border fp-line-soft fp-text-dim"}`}
                    >
                      {r.aiSupport ? "On" : "Off"}
                    </button>
                    <p className="fp-text-faint text-[11px] fp-mono mt-1">owner add-on · comp</p>
                  </td>
                  <td className="py-2.5">
                    <select
                      value={r.planTier ?? ""}
                      onChange={(e) => applyPlan(r.id, e.target.value as "" | "pro" | "business" | "business_plus")}
                      disabled={busyKey !== null}
                      className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1.5 text-xs outline-none focus:fp-gold-border disabled:opacity-60"
                    >
                      <option value="">Free</option>
                      <option value="pro">Pro</option>
                      <option value="business">Business</option>
                      <option value="business_plus">Business+</option>
                    </select>
                    <p className="fp-text-faint text-[11px] fp-mono mt-1">comp · testing</p>
                  </td>
                  <td className="py-2.5">
                    <input
                      value={amountById[r.id] ?? ""}
                      onChange={(e) => setAmountById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="w-28 fp-panel-raised border fp-line-soft rounded-lg px-2.5 py-1.5 text-xs fp-mono outline-none focus:fp-gold-border"
                    />
                  </td>
                  <td className="py-2.5">
                    <input
                      value={reasonById[r.id] ?? ""}
                      onChange={(e) => setReasonById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="Payment error correction"
                      className="w-64 fp-panel-raised border fp-line-soft rounded-lg px-2.5 py-1.5 text-xs outline-none focus:fp-gold-border"
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => apply(r.id, 1)}
                        disabled={busyKey !== null}
                        className="text-xs fp-safe-soft-bg fp-safe px-2.5 py-1.5 rounded-lg disabled:opacity-60"
                      >
                        + Credit
                      </button>
                      <button
                        onClick={() => apply(r.id, -1)}
                        disabled={busyKey !== null}
                        className="text-xs bg-red-500/10 text-red-400 px-2.5 py-1.5 rounded-lg border border-red-500/30 disabled:opacity-60"
                      >
                        − Debit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Landing walkthrough video ---------------- */
function LandingTab() {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = () => getLandingVideo().then((v) => { setUrl(v.url); setSaved(v.url); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (next: string) => {
    setBusy(true); setMsg(null);
    const res = await setLandingVideo(next);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setSaved(next);
    setMsg({ text: next ? "Walkthrough video saved — it's now on the public landing." : "Walkthrough video removed." });
  };

  const preview = toVideoEmbed(url);

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="fp-text-dim text-sm">
        Add a short tutorial/walkthrough that shows how easy it is to create a panel. It appears in a
        <span className="fp-text"> &ldquo;See how it works&rdquo;</span> section on the public Innvil landing.
        Host it on YouTube or Vimeo (or anywhere with a direct <span className="fp-mono">.mp4</span> link) and paste the URL.
      </p>

      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <label className="fp-text-dim text-xs fp-mono uppercase">Walkthrough video URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=…  ·  https://vimeo.com/…  ·  https://cdn.example.com/walkthrough.mp4"
          className={inputCls}
        />
        {msg && (
          <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
            {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => save(url)} disabled={busy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {busy ? "Saving…" : "Save video"}
          </button>
          {saved && (
            <button
              onClick={() => { setUrl(""); save(""); }}
              disabled={busy}
              className="text-xs text-red-400 px-3 py-2 rounded-lg border border-red-500/30 flex items-center gap-1.5"
            >
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="fp-text-faint text-xs fp-mono uppercase mb-2">Preview</p>
        {preview.kind === "none" ? (
          <div className="fp-panel border border-dashed fp-line rounded-2xl aspect-video flex flex-col items-center justify-center gap-2 fp-text-faint">
            <PlayCircle size={26} />
            <span className="text-xs">Paste a valid video URL to preview it here.</span>
          </div>
        ) : (
          <div className="fp-panel border fp-line rounded-2xl overflow-hidden aspect-video">
            {preview.kind === "file" ? (
              <video src={preview.src} controls playsInline className="w-full h-full object-contain bg-black" />
            ) : (
              <iframe src={preview.src} title="Walkthrough preview" allowFullScreen className="w-full h-full" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Owner support ---------------- */
function SupportTab() {
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [rows, setRows] = useState<PlatformSupportMessage[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<InnvilOwnerContact[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [outSubject, setOutSubject] = useState("");
  const [outBody, setOutBody] = useState("");
  const [outBusy, setOutBusy] = useState(false);
  const [outMsg, setOutMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const loadEmail = () => getSupportEmail().then((r) => { setEmail(r.email); setSavedEmail(r.email); }).catch(() => {});
  const loadRows = () => listPlatformSupportMessages().then(setRows).catch(() => setRows([]));
  const loadContacts = () => listInnvilOwnerContacts().then((r) => {
    setContacts(r);
    if (!contactId && r.length > 0) setContactId(r[0].ownerId);
  }).catch(() => setContacts([]));
  useEffect(() => { loadEmail(); loadRows(); loadContacts(); }, []);

  const fmtDate = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const saveEmail = async () => {
    setSavingEmail(true); setEmailMsg(null);
    const res = await setSupportEmail(email);
    setSavingEmail(false);
    if (!res.ok) { setEmailMsg({ text: res.error, error: true }); return; }
    setSavedEmail(email.trim());
    setEmailMsg({ text: email.trim() ? "Support email saved." : "Cleared — messages fall back to super-admin account emails." });
  };

  const setStatus = async (id: string, status: "open" | "resolved") => {
    setBusyId(id);
    const res = await setPlatformSupportStatus(id, status);
    setBusyId(null);
    if (res.ok) setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
  };

  const sendOutreach = async () => {
    if (outBusy) return;
    setOutBusy(true);
    setOutMsg(null);
    const res = await sendSuperAdminOwnerMessage(contactId, outSubject, outBody);
    setOutBusy(false);
    if (!res.ok) {
      setOutMsg({ text: res.error, error: true });
      return;
    }
    setOutMsg({ text: "Message sent to customer." });
    setOutSubject("");
    setOutBody("");
  };

  const sendAutomated = async () => {
    if (outBusy) return;
    setOutBusy(true);
    setOutMsg(null);
    const res = await runDraftOnboardingSweep();
    setOutBusy(false);
    setOutMsg({ text: `Automated outreach sent: ${res.initialSent} initial, ${res.followupsSent} follow-up.` });
  };

  const openCount = (rows ?? []).filter((r) => r.status !== "resolved").length;
  const selectedContact = (contacts ?? []).find((c) => c.ownerId === contactId) ?? null;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <p className="text-sm font-medium">Support destination email</p>
        <p className="fp-text-faint text-xs">
          Owner support messages are emailed here. Leave blank to fall back to the super-admin account email(s).
        </p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="support@yourdomain.com" className={inputCls} />
        {emailMsg && (
          <p className={`text-xs flex items-center gap-1.5 ${emailMsg.error ? "text-red-400" : "fp-safe"}`}>
            {emailMsg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {emailMsg.text}
          </p>
        )}
        <button onClick={saveEmail} disabled={savingEmail || email.trim() === savedEmail.trim()} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
          {savingEmail ? "Saving…" : "Save email"}
        </button>
      </div>

      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Contact Innvil customers</p>
          <button onClick={loadContacts} className="text-xs fp-gold">Refresh list</button>
        </div>
        <p className="fp-text-faint text-xs">
          Reach out directly to panel owners (including newly created draft-only accounts) to offer onboarding help.
        </p>
        {contacts === null ? (
          <p className="fp-text-faint text-sm">Loading customers…</p>
        ) : contacts.length === 0 ? (
          <p className="fp-text-faint text-sm">No panel owners found yet.</p>
        ) : (
          <>
            <label className="fp-text-dim text-xs fp-mono uppercase">Customer</label>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputCls}>
              {contacts.map((c) => (
                <option key={c.ownerId} value={c.ownerId}>
                  {(c.email ?? "unknown email")} · {c.panelCount} panel(s), {c.draftPanels} draft
                </option>
              ))}
            </select>
            {selectedContact && (
              <p className="fp-text-faint text-xs">
                Draft: <span className="fp-text">{selectedContact.draftPanels}</span> · Live: <span className="fp-text">{selectedContact.livePanels}</span>
              </p>
            )}
            <label className="fp-text-dim text-xs fp-mono uppercase">Subject</label>
            <input value={outSubject} onChange={(e) => setOutSubject(e.target.value)} placeholder="Need help launching your panel?" className={inputCls} maxLength={200} />
            <label className="fp-text-dim text-xs fp-mono uppercase">Message</label>
            <textarea value={outBody} onChange={(e) => setOutBody(e.target.value)} rows={4} placeholder="Hi — we can guide you through setup and launch if you need help." className={`${inputCls} resize-y`} maxLength={5000} />
            {outMsg && (
              <p className={`text-xs flex items-center gap-1.5 ${outMsg.error ? "text-red-400" : "fp-safe"}`}>
                {outMsg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {outMsg.text}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button onClick={sendOutreach} disabled={outBusy || !contactId} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                {outBusy ? "Sending…" : "Send message"}
              </button>
              <button onClick={sendAutomated} disabled={outBusy} className="text-xs fp-gold border fp-line-soft rounded-lg px-3 py-2 disabled:opacity-60">
                {outBusy ? "Running…" : "One-click auto send"}
              </button>
            </div>
            <p className="fp-text-faint text-xs">Daily automatic follow-up also runs for still-draft owners.</p>
          </>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Owner messages {openCount > 0 && <span className="fp-gold">· {openCount} open</span>}</p>
        <button onClick={loadRows} className="text-xs fp-gold">Refresh</button>
      </div>

      {rows === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">No support messages yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.id} className="fp-panel border fp-line rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <p className="text-sm font-medium truncate">{m.subject}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <Pill tone={m.status === "resolved" ? "safe" : "muted"}>{m.status === "resolved" ? "Resolved" : "Open"}</Pill>
                  <span className="fp-text-faint text-xs fp-mono">{fmtDate(m.createdAt)}</span>
                </div>
              </div>
              <p className="fp-text-faint text-xs fp-mono mb-2">{m.ownerEmail ?? "unknown sender"}</p>
              <p className="fp-text-dim text-sm leading-relaxed whitespace-pre-line mb-3">{m.body}</p>
              <div className="flex items-center gap-2">
                {m.ownerEmail && (
                  <a href={`mailto:${m.ownerEmail}?subject=${encodeURIComponent("Re: " + m.subject)}`} className="text-xs fp-gold border fp-line-soft rounded-lg px-3 py-1.5">Reply by email</a>
                )}
                {m.status === "resolved" ? (
                  <button onClick={() => setStatus(m.id, "open")} disabled={busyId === m.id} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60">Reopen</button>
                ) : (
                  <button onClick={() => setStatus(m.id, "resolved")} disabled={busyId === m.id} className="text-xs fp-safe-soft-bg fp-safe rounded-lg px-3 py-1.5 disabled:opacity-60 flex items-center gap-1"><CheckCircle2 size={12} /> Mark resolved</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Blog (AI autopilot) — UI now lives in ./BlogReview.tsx.
   The BlogTab below is superseded (kept only until the next cleanup pass); the
   render uses <BlogReview /> instead. ---------------- */
type EditState = { id: string; title: string; description: string; slug: string; tag: string; keywords: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BlogTab() {
  const [posts, setPosts] = useState<AdminBlogPost[] | null>(null);
  const [topics, setTopics] = useState<AdminBlogTopic[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [genTopic, setGenTopic] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [newKeywords, setNewKeywords] = useState("");

  const load = () =>
    Promise.all([listAdminPosts(), listTopics()])
      .then(([p, t]) => { setPosts(p); setTopics(t); })
      .catch((e) => { setPosts([]); setTopics([]); setMsg({ text: e instanceof Error ? e.message : "Load failed.", error: true }); });
  useEffect(() => { load(); }, []);

  const fmtDate = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const generate = async () => {
    setBusy("gen"); setMsg(null);
    const res = await generateDraftNow(genTopic.trim() || undefined);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setGenTopic("");
    setMsg({ text: `Draft written: “${res.data.title}”. Review it below before publishing.` });
    load();
  };

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) => {
    setBusy(key); setMsg(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error ?? "Action failed.", error: true }); return; }
    if (okText) setMsg({ text: okText });
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(`edit:${editing.id}`); setMsg(null);
    const res = await updatePostMeta(editing.id, {
      title: editing.title,
      description: editing.description,
      slug: editing.slug,
      tag: editing.tag,
      keywords: editing.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    });
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setEditing(null);
    setMsg({ text: "Saved." });
    load();
  };

  const addTopicSubmit = async () => {
    if (!newTopic.trim()) return;
    setBusy("addtopic"); setMsg(null);
    const res = await addTopic(newTopic.trim(), newKeywords.split(",").map((k) => k.trim()).filter(Boolean));
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setNewTopic(""); setNewKeywords("");
    load();
  };

  const drafts = (posts ?? []).filter((p) => p.status === "draft");
  const published = (posts ?? []).filter((p) => p.status === "published");
  const pendingTopics = (topics ?? []).filter((t) => t.status === "pending");

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim">
        <span className="fp-text">AI writes drafts; you approve.</span> A daily cron generates one draft from your
        topic queue (or a fallback topic). <span className="fp-text">Nothing goes live until you publish it here</span> —
        this keeps the site safe from search-engine penalties for unreviewed AI content.
      </div>

      {msg && (
        <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
          {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
        </p>
      )}

      {/* Generate now */}
      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <p className="text-sm font-medium flex items-center gap-2"><PenLine size={15} className="fp-gold" /> Generate a draft now</p>
        <p className="fp-text-faint text-xs">Leave the topic blank to use the next queued (or fallback) topic, or type a specific one.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={genTopic}
            onChange={(e) => setGenTopic(e.target.value)}
            placeholder="Optional topic, e.g. How to reduce refunds on an SMM panel"
            className={inputCls}
          />
          <button onClick={generate} disabled={busy === "gen"} className="fp-btn-primary text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-60 whitespace-nowrap shrink-0">
            {busy === "gen" ? "Writing…" : "Generate draft"}
          </button>
        </div>
        <p className="fp-text-faint text-[11px]">Requires <span className="fp-mono">ANTHROPIC_API_KEY</span> on the server.</p>
      </div>

      {/* Drafts awaiting review */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Drafts to review {drafts.length > 0 && <span className="fp-gold">· {drafts.length}</span>}</p>
        {posts === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>
        ) : drafts.length === 0 ? (
          <p className="fp-text-faint text-sm py-4">No drafts waiting. Generate one above or wait for the daily run.</p>
        ) : (
          drafts.map((p) => {
            const isEditing = editing?.id === p.id;
            const isPreview = previewId === p.id;
            return (
              <div key={p.id} className="fp-panel border fp-line rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.title}</p>
                    <p className="fp-text-faint text-xs fp-mono mt-0.5">
                      /blog/{p.slug} · {p.source === "ai" ? "AI" : "manual"}{p.topic ? ` · ${p.topic}` : ""} · {fmtDate(p.createdAt)}
                    </p>
                  </div>
                  <Pill tone="muted">Draft</Pill>
                </div>
                <p className="fp-text-dim text-sm mt-2 leading-relaxed">{p.description}</p>

                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <button onClick={() => { setPreviewId(isPreview ? null : p.id); }} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                    {isPreview ? <><EyeOff size={12} /> Hide</> : <><Eye size={12} /> Preview</>}
                  </button>
                  <button
                    onClick={() => setEditing(isEditing ? null : { id: p.id, title: p.title, description: p.description, slug: p.slug, tag: p.tag, keywords: p.keywords.join(", ") })}
                    className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <PenLine size={12} /> {isEditing ? "Cancel edit" : "Edit"}
                  </button>
                  <button onClick={() => act(`pub:${p.id}`, () => publishPost(p.id), "Published — it's now live on /blog.")} disabled={busy === `pub:${p.id}`} className="text-xs fp-safe-soft-bg fp-safe rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-60">
                    <CheckCircle2 size={12} /> Publish
                  </button>
                  <button onClick={() => act(`del:${p.id}`, () => deletePost(p.id))} disabled={busy === `del:${p.id}`} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-60">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>

                {isEditing && (
                  <div className="mt-4 space-y-2 border-t fp-line-soft pt-4">
                    <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Title" className={inputCls} />
                    <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Meta description" rows={2} className={inputCls} />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="url-slug" className={`${inputCls} fp-mono`} />
                      <input value={editing.tag} onChange={(e) => setEditing({ ...editing, tag: e.target.value })} placeholder="Tag" className={inputCls} />
                    </div>
                    <input value={editing.keywords} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} placeholder="keyword one, keyword two" className={inputCls} />
                    <button onClick={saveEdit} disabled={busy === `edit:${p.id}`} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                      {busy === `edit:${p.id}` ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                )}

                {isPreview && (
                  <div className="mt-4 border-t fp-line-soft pt-5">
                    <h3 className="fp-display text-xl mb-4">{p.title}</h3>
                    <ArticleBody intro={p.intro} sections={p.sections} />
                    {p.cta && (
                      <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 mt-2">
                        <p className="text-sm font-medium mb-1">{p.cta.heading}</p>
                        <p className="fp-text-dim text-sm">{p.cta.text}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Published */}
      {published.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Published · {published.length}</p>
          {published.map((p) => (
            <div key={p.id} className="fp-panel border fp-line rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.title}</p>
                <a href={`/blog/${p.slug}`} target="_blank" rel="noreferrer" className="fp-text-faint text-xs fp-mono flex items-center gap-1 hover:fp-gold">
                  /blog/{p.slug} <ExternalLink size={11} />
                </a>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => act(`unpub:${p.id}`, () => unpublishPost(p.id), "Unpublished — back to draft.")} disabled={busy === `unpub:${p.id}`} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60">Unpublish</button>
                <button onClick={() => act(`del:${p.id}`, () => deletePost(p.id))} disabled={busy === `del:${p.id}`} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1.5 disabled:opacity-60"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Topic queue */}
      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Topic queue {pendingTopics.length > 0 && <span className="fp-gold">· {pendingTopics.length} pending</span>}</p>
          <button onClick={load} className="text-xs fp-gold flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
        </div>
        <p className="fp-text-faint text-xs">The writer takes the highest-priority pending topic first. Empty queue → it uses a built-in fallback topic.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Topic, e.g. SMM panel vs doing it manually" className={inputCls} />
          <input value={newKeywords} onChange={(e) => setNewKeywords(e.target.value)} placeholder="keywords (comma-sep)" className={inputCls} />
          <button onClick={addTopicSubmit} disabled={busy === "addtopic" || !newTopic.trim()} className="fp-btn-primary text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-60 whitespace-nowrap shrink-0 flex items-center gap-1.5">
            <Plus size={14} /> Add
          </button>
        </div>
        {topics === null ? (
          <p className="fp-text-faint text-sm py-2 text-center">Loading…</p>
        ) : (topics.length === 0 ? (
          <p className="fp-text-faint text-xs">No topics yet — add some so the AI writes what you want.</p>
        ) : (
          <div className="space-y-1.5">
            {topics.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs truncate">{t.topic}</p>
                  {t.keywords.length > 0 && <p className="fp-text-faint text-[11px] fp-mono truncate">{t.keywords.join(", ")}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Pill tone={t.status === "pending" ? "gold" : "muted"}>{t.status}</Pill>
                  <button onClick={() => act(`dt:${t.id}`, () => deleteTopic(t.id))} disabled={busy === `dt:${t.id}`} className="text-red-400 disabled:opacity-60"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Archived payments ---------------- */
function ArchivedPaymentsTab() {
  const selectAllRef = React.useRef<HTMLInputElement | null>(null);
  const prevScopeRef = React.useRef<PaymentArchiveSelectionScope | null>(null);
  const [panels, setPanels] = useState<SuperAdminPanelVM[] | null>(null);
  const [activeRows, setActiveRows] = useState<ArchivedPaymentRow[] | null>(null);
  const [archivedRows, setArchivedRows] = useState<ArchivedPaymentRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [prevPanelId, setPrevPanelId] = useState("");
  const [prevView, setPrevView] = useState<"active" | "archived">("active");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [panelId, setPanelId] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "approved" | "rejected" | "completed">("all");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState<null | { kind: "archive" | "restore"; title: string; message: string }>(null);

  const loadPanels = async () => {
    const p = await listPanelsForSuperAdmin(300);
    setPanels(p);
  };

  const loadPanelRows = async (pid: string) => {
    const maskedPanelId = maskPanelIdForLog(pid);
    const startedAt = Date.now();
    console.info("[superadmin-payment-archive] load-start", {
      panelId: maskedPanelId,
      visibleCount: 0,
      archivedCount: 0,
      dbErrorCode: null,
      elapsedTime: 0,
    });

    setLoading(true);
    setLoadFailed(false);
    const [visibleRes, archivedRes] = await Promise.all([
      listVisiblePaymentsForPanel(pid, 1000),
      listArchivedPaymentsForPanel(pid, 1000),
    ]);
    const elapsedTime = Date.now() - startedAt;

    const visibleIsError = "error" in visibleRes;
    const archivedIsError = "error" in archivedRes;

    if (visibleIsError || archivedIsError) {
      const visibleCount = visibleIsError ? 0 : visibleRes.length;
      const archivedCount = archivedIsError ? 0 : archivedRes.length;
      const dbErrorCode = (visibleIsError ? (visibleRes.code ?? null) : null) ?? (archivedIsError ? (archivedRes.code ?? null) : null);
      console.error("[superadmin-payment-archive] load-failed", {
        panelId: maskedPanelId,
        visibleCount,
        archivedCount,
        dbErrorCode,
        elapsedTime,
      });
      setActiveRows([]);
      setArchivedRows([]);
      setLoadFailed(true);
      setLoading(false);
      return;
    }

    console.info("[superadmin-payment-archive] load-result", {
      panelId: maskedPanelId,
      visibleCount: visibleRes.length,
      archivedCount: archivedRes.length,
      dbErrorCode: null,
      elapsedTime,
    });

    setActiveRows(visibleRes);
    setArchivedRows(archivedRes);
    setLoadFailed(false);
    setLoading(false);
  };

  useEffect(() => {
    void loadPanels();
  }, []);

  useEffect(() => {
    const panelChanged = shouldReloadForPanelChange(prevPanelId, panelId);
    const viewChanged = shouldReloadForViewChange(prevView, view);
    setPrevPanelId(panelId);
    setPrevView(view);

    if (!panelId) {
      setActiveRows(null);
      setArchivedRows(null);
      setLoading(false);
      setLoadFailed(false);
      return;
    }

    if (panelChanged || viewChanged || reloadNonce > 0) {
      void loadPanelRows(panelId);
    }
  }, [panelId, view, reloadNonce]);

  useEffect(() => {
    const nextScope: PaymentArchiveSelectionScope = { panelId, search, status, view };
    if (prevScopeRef.current && shouldClearSelection(prevScopeRef.current, nextScope)) {
      setSelected(new Set());
    }
    prevScopeRef.current = nextScope;
  }, [panelId, search, status, view]);

  const filteredActive = filterPaymentArchiveRows(activeRows ?? [], { panelId, status, search });
  const filteredArchived = filterPaymentArchiveRows(archivedRows ?? [], { panelId, status, search });
  const visibleRows = view === "active" ? filteredActive : filteredArchived;
  const panelTotalCount = (activeRows?.length ?? 0) + (archivedRows?.length ?? 0);
  const renderState = deriveArchiveRenderState({
    panelId,
    loading,
    loadFailed,
    panelTotalCount,
    filteredCount: visibleRows.length,
  });
  const visibleIds = visibleRows.map((r) => r.id);
  const selectedCount = selected.size;
  const selectedVisibleCount = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = indeterminate;
  }, [indeterminate, visibleIds.length, selectedVisibleCount]);

  useEffect(() => {
    if (!selected.size) return;
    const visible = new Set(visibleIds);
    for (const id of selected) {
      if (!visible.has(id)) {
        setSelected(new Set());
        return;
      }
    }
  }, [selected, visibleIds]);

  const toggleOne = (paymentId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(paymentId);
      else next.delete(paymentId);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelected(() => {
      if (!checked) return new Set();
      return new Set(visibleIds);
    });
  };

  const selectedRows = visibleRows.filter((r) => selected.has(r.id));
  const breakdown = selectedRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const panelName = (panels ?? []).find((p) => p.id === panelId)?.name ?? "Selected panel";
  const breakdownLines = ["pending", "approved", "rejected", "completed"]
    .filter((k) => (breakdown[k] ?? 0) > 0)
    .map((k) => `${breakdown[k]} ${k}`)
    .join("\n");

  const doArchiveSelected = async () => {
    if (!panelId) {
      setMsg({ text: "Select a panel first.", error: true });
      return;
    }
    if (!selectedCount) return;
    const message = [
      `Archive ${selectedCount} selected payment records?`,
      "",
      "This hides them from visible history only. Their statuses and financial records remain unchanged.",
      "",
      `Panel: ${panelName}`,
      "",
      "Status breakdown:",
      breakdownLines || "(none)",
    ].join("\n");
    setConfirmBulk({ kind: "archive", title: "Archive Selected Payments", message });
  };

  const runArchiveSelected = async () => {
    if (!panelId || !selectedCount) return;

    setBusy("archive-selected");
    setMsg(null);
    const res = await archiveSelectedPayments({ panelId, paymentIds: Array.from(selected), reason });
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    if (res.data.skippedCount > 0) {
      setMsg({ text: `Archived ${res.data.archivedCount} selected payment records. ${res.data.skippedCount} record was skipped.` });
    } else {
      setMsg({ text: `Archived ${res.data.archivedCount} selected payment records.` });
    }
    setSelected(new Set());
    if (shouldReloadAfterBulkMutation(res.ok)) setReloadNonce((v) => v + 1);
  };

  const doRestoreSelected = async () => {
    if (!panelId) {
      setMsg({ text: "Select a panel first.", error: true });
      return;
    }
    if (!selectedCount) return;
    const message = [
      `Restore ${selectedCount} selected payment records?`,
      "",
      `Panel: ${panelName}`,
      "",
      "Status breakdown:",
      breakdownLines || "(none)",
    ].join("\n");
    setConfirmBulk({ kind: "restore", title: "Restore Selected Payments", message });
  };

  const runRestoreSelected = async () => {
    if (!panelId || !selectedCount) return;

    setBusy("restore-selected");
    setMsg(null);
    const res = await restoreSelectedPayments({ panelId, paymentIds: Array.from(selected), reason });
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    if (res.data.skippedCount > 0) {
      setMsg({ text: `Restored ${res.data.restoredCount} selected payment records. ${res.data.skippedCount} record was skipped.` });
    } else {
      setMsg({ text: `Restored ${res.data.restoredCount} selected payment records.` });
    }
    setSelected(new Set());
    if (shouldReloadAfterBulkMutation(res.ok)) setReloadNonce((v) => v + 1);
  };

  const confirmBulkAction = async () => {
    if (!confirmBulk) return;
    const action = confirmBulk;
    setConfirmBulk(null);
    if (action.kind === "archive") {
      await runArchiveSelected();
      return;
    }
    await runRestoreSelected();
  };

  const fmt = (n: number) => `$${n.toFixed(4).replace(/\.?0+$/, "")}`;
  const archiveDisabled = isBulkArchiveDisabled({ selectedCount, panelId, view, busy });
  const restoreDisabled = isBulkRestoreDisabled({ selectedCount, panelId, view, busy });

  return (
    <div className="space-y-4">
      {confirmBulk && (
        <SuperadminConfirmModal
          title={confirmBulk.title}
          message={confirmBulk.message}
          confirmLabel={confirmBulk.kind === "archive" ? "Archive" : "Restore"}
          busy={busy === "archive-selected" || busy === "restore-selected"}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={confirmBulkAction}
        />
      )}
      <Card title="Archive payment history" icon={Lock}>
        <p className="fp-text-dim text-sm leading-relaxed">{PAYMENT_ARCHIVE_CONFIRM_COPY}</p>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr] mt-4">
          <select
            value={panelId}
            onChange={(e) => setPanelId(e.target.value)}
            className={inputCls}
          >
            <option value="">Select panel</option>
            {(panels ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.subdomain})</option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payment ID, customer, gateway, panel"
            className={inputCls}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>
            <option value="all">All statuses</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="completed">completed</option>
          </select>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr] mt-3">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className={inputCls}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={doArchiveSelected}
              disabled={archiveDisabled}
              className="fp-btn-primary text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-60"
            >
              {busy === "archive-selected" ? "Archiving…" : "Archive selected"}
            </button>
            <button
              onClick={doRestoreSelected}
              disabled={restoreDisabled}
              className="text-sm font-semibold px-4 py-2.5 rounded-lg border fp-line-soft disabled:opacity-60"
            >
              {busy === "restore-selected" ? "Restoring…" : "Restore selected"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
          <button onClick={() => setView("active")} className={`px-2.5 py-1.5 rounded-lg border ${view === "active" ? "fp-gold-border fp-gold" : "fp-line-soft"}`}>
            Visible
          </button>
          <button onClick={() => setView("archived")} className={`px-2.5 py-1.5 rounded-lg border ${view === "archived" ? "fp-gold-border fp-gold" : "fp-line-soft"}`}>
            Archived
          </button>
          <span className="fp-text-dim">{selectedCount} payments selected</span>
        </div>
      </Card>

      {msg && (
        <div className={`text-sm px-4 py-2.5 rounded-lg border flex items-center gap-2 ${msg.error ? "bg-red-500/10 border-red-500/30 text-red-400" : "fp-safe-soft-bg fp-safe-border fp-safe"}`}>
          {msg.error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />} {msg.text}
        </div>
      )}

      <Card title={view === "active" ? "Active payment history" : "Archived payment history"} icon={view === "active" ? Wallet : EyeOff}>
        {renderState === "no-panel" ? (
          <p className="fp-text-faint text-sm py-4 text-center">Select a panel to view payment history.</p>
        ) : renderState === "loading" ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading payment history...</p>
        ) : renderState === "load-failed" ? (
          <p className="text-red-400 text-sm py-4 text-center">Could not load payment history. Please try again.</p>
        ) : renderState === "panel-empty" ? (
          <p className="fp-text-faint text-sm py-4 text-center">No payment records exist for this panel.</p>
        ) : renderState === "filter-empty" ? (
          <p className="fp-text-faint text-sm py-4 text-center">No payment history rows match the current filters.</p>
        ) : (
          <div className="space-y-2">
            <label className="text-xs flex items-center gap-2">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) => toggleAllVisible(e.target.checked)}
              />
              Select all visible payments
            </label>
            {visibleRows.map((r) => (
              <div key={r.id} className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs">
                <div className="grid gap-2 md:grid-cols-[auto_1.2fr_1fr_1fr_1fr_auto] items-start">
                  <div className="pt-0.5">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) => toggleOne(r.id, e.target.checked)}
                    />
                  </div>
                  <div>
                    <p className="fp-mono" title={r.id}>{r.maskedPaymentId}</p>
                    <p className="fp-text-faint truncate">{r.panelName}</p>
                    <p className="fp-text-faint truncate">{r.customerUsername ?? r.customerEmail ?? r.customerId}</p>
                  </div>
                  <div>
                    <p>{r.gateway ?? "manual"}</p>
                    <p className="fp-text-faint">{r.method}</p>
                  </div>
                  <div>
                    <p className="fp-mono">{fmt(r.amount)}</p>
                    <p className="fp-text-faint">{r.status}</p>
                  </div>
                  <div>
                    <p>{new Date(r.createdAt).toLocaleString()}</p>
                    <p className="fp-text-faint">{r.archivedAt ? `Archived: ${new Date(r.archivedAt).toLocaleString()}` : "—"}</p>
                  </div>
                  <div>
                    {view === "archived" ? (
                      <p className="fp-text-faint truncate">{r.archivedByEmail ?? r.archivedBy ?? "—"}<br />{r.reason ?? "No reason"}</p>
                    ) : (
                      <p className="fp-text-faint">Visible</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SuperadminConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCancel}>
      <div className="w-full max-w-lg fp-panel border fp-line rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b fp-line-soft">
          <p className="fp-display text-sm flex items-center gap-2"><Lock size={14} className="fp-gold" /> {title}</p>
          <button onClick={onCancel} className="fp-text-faint hover:fp-text" aria-label="Close confirmation"><Trash2 size={15} /></button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm fp-text-dim whitespace-pre-line leading-relaxed">{message}</p>
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text disabled:opacity-50">Cancel</button>
          <button onClick={() => { void onConfirm(); }} disabled={busy} className="fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Shell ---------------- */
const TABS = [
  { k: "overview", label: "Overview", icon: LayoutGrid },
  { k: "panels", label: "Panels", icon: Wallet },
  { k: "payments", label: "Platform payments", icon: CreditCard },
  { k: "archived-payments", label: "Archived payments", icon: EyeOff },
  { k: "blog", label: "Blog", icon: Newspaper },
  { k: "pricing", label: "Design pricing", icon: Tag },
  { k: "landing", label: "Landing video", icon: PlayCircle },
  { k: "support", label: "Support", icon: LifeBuoy },
];

export function SuperAdminDashboard() {
  const [tab, setTab] = useState("overview");
  return (
    <div className="fp-root min-h-screen">
      <div className="px-8 pt-6 pb-4 border-b fp-line-soft flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
            <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
          </div>
          <div>
            <p className="fp-display text-xl flex items-center gap-2">Innvil <span className="text-xs fp-gold-soft-bg fp-gold px-2 py-0.5 rounded-full flex items-center gap-1"><ShieldCheck size={11} /> Super admin</span></p>
            <p className="fp-text-faint text-xs">Platform control panel</p>
          </div>
        </div>
        <Link href="/" className="fp-panel-raised border fp-line-soft text-sm px-4 py-2 rounded-lg flex items-center gap-1.5 hover:fp-gold-border">
          <ArrowLeft size={14} /> Exit
        </Link>
      </div>

      <div className="px-4 sm:px-8 pt-4 border-b fp-line-soft flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`flex items-center gap-1.5 text-xs px-3 py-2.5 rounded-t-lg whitespace-nowrap ${tab === t.k ? "fp-gold border-b-2 fp-gold-border" : "fp-text-dim"}`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      <div className="p-8 space-y-6">
        {tab === "overview" && (
          <>
            <OverviewTab />
            <Card title="Platform payments" icon={Lock}>
              <p className="fp-text-dim text-sm">
                Configure how owners pay Innvil under <button onClick={() => setTab("payments")} className="fp-gold">Platform payments</button>.
                Cryptomus and NOWPayments are supported today.
              </p>
            </Card>
          </>
        )}
        {tab === "panels" && <PanelsTab />}
        {tab === "payments" && <PaymentsTab />}
        {tab === "archived-payments" && <ArchivedPaymentsTab />}
        {tab === "blog" && <BlogReview />}
        {tab === "pricing" && <DesignPricingAdmin />}
        {tab === "landing" && <LandingTab />}
        {tab === "support" && <SupportTab />}
      </div>
    </div>
  );
}
