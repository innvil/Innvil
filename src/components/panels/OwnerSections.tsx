"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListOrdered, Users, Wallet, Plus, History, HelpCircle, RefreshCw, AlertTriangle, Wifi, CheckCircle2, LifeBuoy, Send, Download, Trash2, CalendarDays } from "lucide-react";
import { Card, Pill, StatCard } from "@/src/components/ui";
import { listProviderTopups, deleteProviderTopup, setProviderTopupKind, type ProviderTopup } from "@/src/lib/actions/provider-topups";
import { formatMoney } from "@/src/lib/money";
import { listAllOwnerOrders, getOwnerBillingSummary, type OwnerOrderVM, type OwnerBillingSummary } from "@/src/lib/actions/admin-orders";
import {
  sendOwnerSupportMessage,
  listInnvilOwnerContacts,
  sendSuperAdminOwnerMessage,
  runDraftOnboardingSweep,
  type InnvilOwnerContact,
} from "@/src/lib/actions/platform-support";
import { PlatformSupportInbox } from "@/src/components/panels/PlatformSupportInbox";
import { listAllOwnerCustomers, adjustCustomerBalance, type OwnerCustomerVM } from "@/src/lib/actions/customers";
import { listAllOwnerProviders, fetchProviderBalance, refreshAllProviderBalances, type OwnerProviderVM } from "@/src/lib/actions/providers";
import { listAllOwnerDeposits, type OwnerAllDepositVM } from "@/src/lib/actions/payments";

// Provider (API) balance thresholds — a provider at/under LOW needs a top-up soon.
const LOW_BALANCE_THRESHOLD = 10; // in the provider's own currency
const BALANCE_STALE_MS = 10 * 60 * 1000;
function balanceIsStale(iso: string | null | undefined): boolean {
  return !iso || Date.now() - new Date(iso).getTime() > BALANCE_STALE_MS;
}
function shortAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

const OWNER_CACHE_PREFIX = "innvil-owner";
const OWNER_AUTO_REFRESH_MS = 30_000;
const ownerSectionMemory = new Map<string, unknown>();

function getOwnerCacheKey(section: string) {
  return `${OWNER_CACHE_PREFIX}:${section}`;
}

function readOwnerCache<T>(section: string): T | null {
  const key = getOwnerCacheKey(section);
  if (ownerSectionMemory.has(key)) return ownerSectionMemory.get(key) as T;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    ownerSectionMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeOwnerCache<T>(section: string, value: T) {
  const key = getOwnerCacheKey(section);
  ownerSectionMemory.set(key, value);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function SyncBadge({ syncing }: { syncing: boolean }) {
  if (!syncing) return null;
  return (
    <span className="text-xs fp-text-faint flex items-center gap-1.5">
      <RefreshCw size={12} className="animate-spin" /> Syncing…
    </span>
  );
}

const STATUS_TONE: Record<string, "safe" | "gold" | "violet" | "muted"> = {
  completed: "safe", processing: "gold", in_progress: "gold", pending: "violet",
  partial: "gold", canceled: "muted", failed: "muted", refunded: "muted", duplicate: "violet",
};
const STATUS_LABEL: Record<string, string> = {
  completed: "Completed", processing: "Processing", in_progress: "In progress",
  pending: "Pending", partial: "Partial", canceled: "Canceled", failed: "Failed", refunded: "Refunded", duplicate: "Duplicate",
};

/* ---------- Orders across all panels ---------- */
export function OwnerOrders({ onManageCustomer }: { onManageCustomer?: (customerAccountId: string) => void }) {
  const cachedRows = readOwnerCache<OwnerOrderVM[]>("orders");
  const [rows, setRows] = useState<OwnerOrderVM[] | null>(cachedRows);
  const [syncing, setSyncing] = useState(Boolean(cachedRows));
  const refreshingRef = useRef(false);

  const refreshOrders = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setSyncing(true);
    try {
      const next = await listAllOwnerOrders();
      setRows(next);
      writeOwnerCache("orders", next);
    } finally {
      setSyncing(false);
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshOrders();
    }, OWNER_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshOrders]);
  const fmt = (n: number) => formatMoney(n, "USD");

  return (
    <div className="p-4 sm:p-8">
      <Card title="Orders — all panels" icon={ListOrdered} right={<SyncBadge syncing={syncing} />}>
        {rows === null ? (
          <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">No orders across your panels yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                  <th className="py-2 font-normal">ID</th>
                  <th className="py-2 font-normal">Panel</th>
                  <th className="py-2 font-normal">Service</th>
                  <th className="py-2 font-normal">Customer</th>
                  <th className="py-2 font-normal">Link</th>
                  <th className="py-2 font-normal text-right">Charge</th>
                  <th className="py-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b fp-line-soft last:border-0">
                    <td className="py-2.5 fp-mono fp-text-dim">#{o.orderNo ?? o.shortId}</td>
                    <td className="py-2.5">{o.panelName}</td>
                    <td className="py-2.5">{o.serviceName}{o.serviceNo != null && <span className="fp-text-faint"> · #{o.serviceNo}</span>}</td>
                    <td className="py-2.5 fp-text-dim">
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
                    <td className="py-2.5 max-w-[280px]">
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
                    <td className="py-2.5 text-right fp-mono">{fmt(o.charge)}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Pill tone={STATUS_TONE[o.status] ?? "muted"}>{STATUS_LABEL[o.status] ?? o.status}</Pill>
                        {o.held && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> On hold</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Customers across all panels ---------- */
export function OwnerCustomers({ focusCustomerId }: { focusCustomerId?: string | null }) {
  const cachedRows = readOwnerCache<OwnerCustomerVM[]>("customers");
  const [rows, setRows] = useState<OwnerCustomerVM[] | null>(cachedRows);
  const [syncing, setSyncing] = useState(Boolean(cachedRows));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const refreshingRef = useRef(false);

  const refreshCustomers = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setSyncing(true);
    try {
      const next = await listAllOwnerCustomers();
      setRows(next);
      writeOwnerCache("customers", next);
    } finally {
      setSyncing(false);
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshCustomers();
  }, [refreshCustomers]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busy) return;
      void refreshCustomers();
    }, OWNER_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [busy, refreshCustomers]);
  const fmt = (n: number) => formatMoney(n, "USD");

  const openRow = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
    setAmount(""); setReason(""); setMsg(null);
  };

  useEffect(() => {
    if (!focusCustomerId) return;
    const exists = (rows ?? []).some((r) => r.id === focusCustomerId);
    if (!exists) return;
    setExpanded(focusCustomerId);
    setAmount(""); setReason(""); setMsg(null);
  }, [focusCustomerId, rows]);

  const adjust = async (c: OwnerCustomerVM, sign: 1 | -1) => {
    const amt = Number(amount) * sign;
    if (!Number.isFinite(amt) || amt === 0) { setMsg({ text: "Enter an amount.", error: true }); return; }
    if (!reason.trim()) { setMsg({ text: "Add a reason (e.g. payment error fix).", error: true }); return; }
    setBusy(true); setMsg(null);
    const res = await adjustCustomerBalance(c.id, amt, reason.trim());
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    const newBal = res.data.balance;
    setRows((prev) => {
      const next = (prev ?? []).map((r) => (r.id === c.id ? { ...r, balance: newBal } : r));
      writeOwnerCache("customers", next);
      return next;
    });
    setAmount(""); setReason("");
    setMsg({ text: `Balance updated to ${fmt(newBal)}. Ask the customer to refresh their wallet.` });
  };

  return (
    <div className="p-4 sm:p-8">
      <Card title="Customers — all panels" icon={Users} right={<SyncBadge syncing={syncing} />}>
        {rows === null ? (
          <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">No customers across your panels yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                  <th className="py-2 font-normal">Customer</th>
                  <th className="py-2 font-normal">Panel</th>
                  <th className="py-2 font-normal text-right">Orders</th>
                  <th className="py-2 font-normal text-right">Spent</th>
                  <th className="py-2 font-normal text-right">Balance</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const open = expanded === c.id;
                  return (
                    <React.Fragment key={c.id}>
                      <tr className="border-b fp-line-soft last:border-0 cursor-pointer hover:fp-panel-raised" onClick={() => openRow(c.id)}>
                        <td className="py-2.5">{c.username ?? c.email ?? "—"}</td>
                        <td className="py-2.5 fp-text-dim">{c.panelName}</td>
                        <td className="py-2.5 text-right fp-mono">{c.orders}</td>
                        <td className="py-2.5 text-right fp-mono">{fmt(c.spent)}</td>
                        <td className="py-2.5 text-right fp-mono">{fmt(c.balance)}</td>
                        <td className="py-2.5 text-right"><span className="fp-gold text-xs">{open ? "Hide" : "Manage customer"}</span></td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} className="pb-4">
                            <div className="fp-panel-raised border fp-line-soft rounded-lg p-4">
                              <p className="fp-text-faint text-[11px] fp-mono uppercase mb-3">Adjust balance · {c.username ?? c.email ?? "customer"} · {c.panelName}</p>
                              <div className="flex flex-wrap items-end gap-2">
                                <div>
                                  <label className="fp-text-dim text-[11px]">Amount (USD)</label>
                                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="block w-28 fp-panel border fp-line-soft rounded-lg px-2 py-1.5 text-sm fp-mono outline-none focus:fp-gold-border mt-1" />
                                </div>
                                <div className="flex-1 min-w-[160px]">
                                  <label className="fp-text-dim text-[11px]">Reason</label>
                                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. payment error correction" className="block w-full fp-panel border fp-line-soft rounded-lg px-2 py-1.5 text-sm outline-none focus:fp-gold-border mt-1" />
                                </div>
                                <button disabled={busy} onClick={() => adjust(c, 1)} className="fp-panel border fp-safe-border fp-safe rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">Credit +</button>
                                <button disabled={busy} onClick={() => adjust(c, -1)} className="fp-panel border border-red-500/30 text-red-400 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">Debit −</button>
                              </div>
                              {msg && <p className={`text-xs mt-2 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</p>}
                              <p className="fp-text-faint text-[11px] mt-2">Manual balance adjustment only — for fixing payment errors. You can&apos;t log in as the customer or reset their password.</p>
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
    </div>
  );
}

/* ---------- Providers across all panels ---------- */
export function OwnerProviders() {
  const cachedRows = readOwnerCache<OwnerProviderVM[]>("providers");
  const [rows, setRows] = useState<OwnerProviderVM[] | null>(cachedRows);
  const [syncing, setSyncing] = useState(Boolean(cachedRows));
  const [busyId, setBusyId] = useState<string | null>(null);
  const autoFetchedRef = useRef(false);

  const load = async () => {
    const next = await listAllOwnerProviders();
    setRows(next);
    writeOwnerCache("providers", next);
    return next;
  };

  useEffect(() => {
    let alive = true;
    setSyncing(rows !== null);
    load().then((next) => {
      if (!alive) return;
      setSyncing(false);
      // Auto-refresh stale/missing balances once.
      if (autoFetchedRef.current) return;
      const stale = next.filter((p) => p.balance == null || balanceIsStale(p.last_balance_sync));
      if (stale.length === 0) { autoFetchedRef.current = true; return; }
      autoFetchedRef.current = true;
      setSyncing(true);
      Promise.all(stale.map((p) => fetchProviderBalance(p.id).catch(() => null)))
        .then(() => { if (alive) load(); })
        .finally(() => { if (alive) setSyncing(false); });
    }).catch(() => { if (alive) setSyncing(false); });
    return () => { alive = false; };
  }, []);

  const refreshOne = async (id: string) => {
    setBusyId(id);
    await fetchProviderBalance(id).catch(() => null);
    await load();
    setBusyId(null);
  };

  return (
    <div className="p-4 sm:p-8">
      <Card title="Providers — all panels" icon={Wifi} right={<SyncBadge syncing={syncing} />}>
        {rows === null ? (
          <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">No providers connected on any panel yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                  <th className="py-2 font-normal">Provider</th>
                  <th className="py-2 font-normal">Panel</th>
                  <th className="py-2 font-normal">Status</th>
                  <th className="py-2 font-normal">Balance</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b fp-line-soft last:border-0 align-top">
                    <td className="py-3">
                      {p.name}
                      <p className="fp-text-faint text-[10px] fp-mono truncate max-w-[220px]">{p.api_url}</p>
                    </td>
                    <td className="py-3 fp-text-dim">{p.panelName}</td>
                    <td className="py-3"><Pill tone={p.status === "active" ? "safe" : "muted"}>{p.status}</Pill></td>
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
                    <td className="py-3 text-right">
                      <button onClick={() => refreshOne(p.id)} disabled={busyId === p.id} className="fp-text-dim hover:fp-text text-xs flex items-center gap-1 disabled:opacity-50 ml-auto">
                        <RefreshCw size={11} className={busyId === p.id ? "animate-spin" : ""} /> Refresh
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Provider balance tracker (dedicated, balance-first) ---------- */
type TrackerPeriod = "weekly" | "biweekly" | "monthly";
function startOfWeekMon(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}
function periodStart(d: Date, type: TrackerPeriod): Date {
  if (type === "monthly") return new Date(d.getFullYear(), d.getMonth(), 1);
  const wk = startOfWeekMon(d);
  if (type === "weekly") return wk;
  const anchor = startOfWeekMon(new Date(2024, 0, 1)); // fixed Monday to bucket bi-weeks
  const weeks = Math.floor((wk.getTime() - anchor.getTime()) / (7 * 86400000));
  return new Date(anchor.getTime() + (weeks - (((weeks % 2) + 2) % 2)) * 7 * 86400000);
}
function periodLabel(start: Date, type: TrackerPeriod): string {
  if (type === "monthly") return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const end = new Date(start);
  end.setDate(end.getDate() + (type === "biweekly" ? 13 : 6));
  const f = (x: Date) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(start)} – ${f(end)}`;
}
function fmtAmt(n: number, cur: string): string {
  return cur === "USD"
    ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cur}`;
}
function fmtByCurrency(m: Map<string, number>): string {
  const parts = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, n]) => fmtAmt(n, c));
  return parts.length ? parts.join(" + ") : "$0.00";
}
function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function OwnerProviderBalances() {
  const cachedRows = readOwnerCache<OwnerProviderVM[]>("providers");
  const [rows, setRows] = useState<OwnerProviderVM[] | null>(cachedRows);
  const [syncing, setSyncing] = useState(Boolean(cachedRows));
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const autoFetchedRef = useRef(false);

  // Top-up tracker (auto-recorded balance increases).
  const [topups, setTopups] = useState<ProviderTopup[] | null>(() => readOwnerCache<ProviderTopup[]>("provider-topups"));
  const [period, setPeriod] = useState<TrackerPeriod>("weekly");
  const [delBusy, setDelBusy] = useState<string | null>(null);

  const load = async () => {
    const next = await listAllOwnerProviders();
    setRows(next);
    writeOwnerCache("providers", next);
    return next;
  };
  const loadTopups = async () => {
    const next = await listProviderTopups().catch(() => [] as ProviderTopup[]);
    setTopups(next);
    writeOwnerCache("provider-topups", next);
    return next;
  };

  useEffect(() => {
    let alive = true;
    setSyncing(rows !== null);
    loadTopups();
    load().then((next) => {
      if (!alive) return;
      setSyncing(false);
      if (autoFetchedRef.current) return;
      const stale = next.filter((p) => p.balance == null || balanceIsStale(p.last_balance_sync));
      if (stale.length === 0) { autoFetchedRef.current = true; return; }
      autoFetchedRef.current = true;
      setSyncing(true);
      Promise.all(stale.map((p) => fetchProviderBalance(p.id).catch(() => null)))
        .then(() => { if (alive) { load(); loadTopups(); } })
        .finally(() => { if (alive) setSyncing(false); });
    }).catch(() => { if (alive) setSyncing(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = async () => {
    if (!rows?.length) return;
    setRefreshingAll(true);
    // One batched server action refreshes every provider in parallel server-side
    // (Next serializes separate server actions from one client, so N calls are slow).
    await refreshAllProviderBalances().catch(() => null);
    await Promise.all([load(), loadTopups()]);
    setRefreshingAll(false);
  };

  const refreshOne = async (id: string) => {
    setBusyId(id);
    await fetchProviderBalance(id).catch(() => null);
    await Promise.all([load(), loadTopups()]);
    setBusyId(null);
  };

  const delEntry = async (id: string) => {
    setDelBusy(id);
    const res = await deleteProviderTopup(id);
    setDelBusy(null);
    if (res.ok) setTopups((prev) => (prev ?? []).filter((t) => t.id !== id));
  };

  const classify = async (id: string, kind: "topup" | "refund") => {
    setDelBusy(id);
    const res = await setProviderTopupKind(id, kind);
    setDelBusy(null);
    if (res.ok) setTopups((prev) => (prev ?? []).map((t) => (t.id === id ? { ...t, kind, needsReview: false } : t)));
  };

  const downloadCsv = () => {
    // Only real top-ups (refund-tagged entries are excluded from the cost record).
    const list = (topups ?? []).filter((t) => t.kind !== "refund");
    if (!list.length) return;
    const header = "Date,Provider,Amount,Currency,Note";
    const lines = list.map((t) => [
      new Date(t.toppedUpAt).toISOString().slice(0, 10),
      csvEscape(t.providerName),
      t.amount.toFixed(2),
      t.currency,
      csvEscape(t.note ?? ""),
    ].join(","));
    const blob = new Blob([[header, ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `innvil-provider-topups-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; label: string; start: number; byCurrency: Map<string, number>; byProvider: Map<string, Map<string, number>> }>();
    for (const t of topups ?? []) {
      if (t.kind === "refund") continue; // refund-tagged entries don't count toward totals
      const start = periodStart(new Date(t.toppedUpAt), period);
      const key = start.toISOString();
      let g = map.get(key);
      if (!g) { g = { key, label: periodLabel(start, period), start: start.getTime(), byCurrency: new Map(), byProvider: new Map() }; map.set(key, g); }
      g.byCurrency.set(t.currency, (g.byCurrency.get(t.currency) ?? 0) + t.amount);
      let pm = g.byProvider.get(t.providerName);
      if (!pm) { pm = new Map(); g.byProvider.set(t.providerName, pm); }
      pm.set(t.currency, (pm.get(t.currency) ?? 0) + t.amount);
    }
    return [...map.values()].sort((a, b) => b.start - a.start).slice(0, 12);
  }, [topups, period]);

  // Balances live in each provider's own currency, so totals are grouped by currency.
  const byCurrency = new Map<string, number>();
  let lowCount = 0;
  let emptyCount = 0;
  for (const p of rows ?? []) {
    if (p.balance == null) continue;
    const cur = (p.currency || "USD").toUpperCase();
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(p.balance));
    if (p.balance <= 0) emptyCount++;
    else if (p.balance < LOW_BALANCE_THRESHOLD) lowCount++;
  }
  const totals = [...byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="fp-display text-2xl">Provider balances</h1>
        <div className="flex items-center gap-3">
          <SyncBadge syncing={syncing} />
          <button onClick={refreshAll} disabled={refreshingAll || !rows?.length} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm disabled:opacity-60">
            <RefreshCw size={14} className={refreshingAll ? "animate-spin" : ""} /> {refreshingAll ? "Refreshing…" : "Refresh all"}
          </button>
        </div>
      </div>
      <p className="fp-text-dim text-sm">
        Live balances across every provider you&apos;ve connected — see at a glance how much you have funded on the
        provider side, and which ones need a top-up.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Providers" value={rows ? String(rows.length) : "—"} />
        <StatCard label="Needs top-up" value={rows ? String(emptyCount) : "—"} />
        <StatCard label="Low balance" value={rows ? String(lowCount) : "—"} tone="gold" />
        <StatCard label="Healthy" value={rows ? String(Math.max(rows.filter((p) => p.balance != null).length - lowCount - emptyCount, 0)) : "—"} tone="safe" />
      </div>

      {totals.length > 0 && (
        <Card title="Total funded on providers" icon={Wallet}>
          <p className="fp-text-faint text-xs mb-3">Summed per currency (providers can bill in different currencies).</p>
          <div className="flex flex-wrap gap-3">
            {totals.map(([cur, sum]) => (
              <div key={cur} className="fp-panel-raised border fp-line-soft rounded-xl px-4 py-3">
                <p className="fp-display text-2xl fp-gold">{sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                <p className="fp-text-faint text-xs fp-mono mt-0.5">{cur}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="By provider" icon={Wifi} right={<SyncBadge syncing={syncing} />}>
        {rows === null ? (
          <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">No providers connected on any panel yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((p) => {
              const empty = p.balance != null && p.balance <= 0;
              const low = p.balance != null && p.balance > 0 && p.balance < LOW_BALANCE_THRESHOLD;
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 fp-panel-raised border fp-line-soft rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="fp-text-faint text-[11px] fp-mono truncate">{p.panelName} · {shortAgo(p.last_balance_sync)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {p.balance == null ? (
                      <span className="fp-text-faint text-xs">—</span>
                    ) : (
                      <span className={`fp-mono text-sm font-medium ${empty ? "text-red-400" : low ? "fp-gold" : "fp-text"}`}>
                        {Number(p.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {p.currency}
                      </span>
                    )}
                    {empty ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> Top up</span>
                    ) : low ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full fp-gold-soft-bg fp-gold">Low</span>
                    ) : null}
                    <button onClick={() => refreshOne(p.id)} disabled={busyId === p.id} className="fp-text-dim hover:fp-text text-xs flex items-center gap-1 disabled:opacity-50">
                      <RefreshCw size={11} className={busyId === p.id ? "animate-spin" : ""} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Auto top-up tracker — Innvil records every balance INCREASE as a provider top-up. */}
      <Card
        title="Top-up tracker"
        icon={CalendarDays}
        right={(
          <div className="flex items-center gap-2">
            <div className="flex fp-panel-raised rounded-lg p-0.5 text-xs">
              {(["weekly", "biweekly", "monthly"] as TrackerPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 rounded-md ${period === p ? "fp-gold-bg text-[#0A0B0F] font-semibold" : "fp-text-dim hover:fp-text"}`}
                >
                  {p === "weekly" ? "Weekly" : p === "biweekly" ? "Bi-weekly" : "Monthly"}
                </button>
              ))}
            </div>
            <button onClick={downloadCsv} disabled={!topups?.length} className="fp-panel-raised border fp-line-soft text-xs px-3 py-1.5 rounded-lg fp-text-dim flex items-center gap-1.5 disabled:opacity-50 hover:fp-gold-border">
              <Download size={12} /> CSV
            </button>
          </div>
        )}
      >
        <p className="fp-text-faint text-xs mb-4 leading-relaxed">
          Innvil watches your provider balances and records every increase automatically, netting out the
          refunds it already knows about. It&apos;s an internal spend record to weigh against your earnings —
          balances funded before Innvil aren&apos;t counted, and anything flagged as a refund is left out of
          the totals. Not an official receipt.
        </p>
        {topups === null ? (
          <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
        ) : topups.length === 0 ? (
          <p className="fp-text-faint text-sm py-6 text-center">No top-ups tracked yet — fund any provider and the increase shows up here after the next balance sync.</p>
        ) : (
          <div className="space-y-3">
            {grouped.map((g, i) => (
              <div key={g.key} className={`fp-panel-raised border rounded-xl p-4 ${i === 0 ? "fp-gold-border" : "fp-line-soft"}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">
                    {g.label}
                    {i === 0 && <span className="fp-text-faint text-xs fp-mono"> · current</span>}
                  </p>
                  <span className="fp-mono text-sm fp-gold">{fmtByCurrency(g.byCurrency)}</span>
                </div>
                <div className="space-y-1">
                  {[...g.byProvider.entries()].map(([name, m]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="fp-text-dim truncate">{name}</span>
                      <span className="fp-mono shrink-0">{fmtByCurrency(m)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {topups && topups.length > 0 && (
        <Card title="Recorded top-ups" icon={History}>
          <div className="space-y-1.5 max-h-96 overflow-auto">
            {topups.slice(0, 40).map((t) => {
              const isRefund = t.kind === "refund";
              return (
                <div key={t.id} className={`border-b fp-line-soft last:border-0 py-2 ${isRefund ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span className="fp-text-dim">{new Date(t.toppedUpAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                      <span className="fp-text-faint"> · {t.providerName}</span>
                      {isRefund && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full fp-panel border fp-line-soft fp-text-faint">Refund · not counted</span>}
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className={`fp-mono ${isRefund ? "fp-text-faint line-through" : "fp-safe"}`}>+{fmtAmt(t.amount, t.currency)}</span>
                      {isRefund ? (
                        <button onClick={() => classify(t.id, "topup")} disabled={delBusy === t.id} className="fp-gold text-[11px] disabled:opacity-50" title="Count as a top-up again">Count</button>
                      ) : (
                        <button onClick={() => classify(t.id, "refund")} disabled={delBusy === t.id} className="fp-text-faint hover:fp-text text-[11px] disabled:opacity-50" title="Exclude — this was a refund">Refund?</button>
                      )}
                      <button onClick={() => delEntry(t.id)} disabled={delBusy === t.id} className="fp-text-faint hover:text-red-400 disabled:opacity-50" title="Remove">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {t.needsReview && !isRefund && (
                    <div className="mt-1.5 flex items-center gap-2 fp-gold-soft-bg rounded-lg px-2.5 py-1.5">
                      <span className="text-[11px] fp-gold flex items-center gap-1"><AlertTriangle size={11} /> Unusual increase — is this a refund?</span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        <button onClick={() => classify(t.id, "refund")} disabled={delBusy === t.id} className="text-[11px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 disabled:opacity-50">Yes, refund</button>
                        <button onClick={() => classify(t.id, "topup")} disabled={delBusy === t.id} className="text-[11px] px-2 py-0.5 rounded-md fp-safe-soft-bg fp-safe disabled:opacity-50">No, top-up</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- Recent top-ups across all panels (Earnings section) ---------- */
export function OwnerTopUps() {
  const cachedRows = readOwnerCache<OwnerAllDepositVM[]>("topups");
  const [rows, setRows] = useState<OwnerAllDepositVM[] | null>(cachedRows);
  const [syncing, setSyncing] = useState(Boolean(cachedRows));
  useEffect(() => {
    let alive = true;
    setSyncing(rows !== null);
    listAllOwnerDeposits().then((next) => {
      if (!alive) return;
      setRows(next);
      writeOwnerCache("topups", next);
      setSyncing(false);
    }).catch(() => { if (alive) setSyncing(false); });
    return () => { alive = false; };
  }, []);

  const statusTone = (s: string) =>
    s === "completed" ? "fp-safe" : s === "pending" ? "fp-gold" : "fp-text-faint";

  return (
    <Card title="Recent top-ups — all panels" icon={Wallet} right={<SyncBadge syncing={syncing} />}>
      {rows === null ? (
        <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="fp-text-faint text-sm py-4 text-center">No customer top-ups yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 20).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 border-b fp-line-soft last:border-0 py-2.5">
              <div className="min-w-0">
                <p className="text-sm truncate">{r.customerUsername ?? r.customerEmail ?? "customer"}</p>
                <p className="fp-text-faint text-xs truncate">{r.panelName} · {r.method} · {new Date(r.createdAt).toLocaleString()} · <span className={statusTone(r.status)}>{r.status}</span></p>
              </div>
              <span className="fp-mono text-sm fp-gold shrink-0">+{r.amount.toFixed(2)} {r.currency}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- Billing (real revenue + 5% commission estimate) ---------- */
export function OwnerBilling({ onAddFunds }: { onAddFunds: () => void }) {
  const cachedData = readOwnerCache<OwnerBillingSummary>("billing");
  const [data, setData] = useState<OwnerBillingSummary | null>(cachedData);
  const [syncing, setSyncing] = useState(Boolean(cachedData));
  useEffect(() => {
    let alive = true;
    setSyncing(data !== null);
    getOwnerBillingSummary().then((next) => {
      if (!alive) return;
      setData(next);
      writeOwnerCache("billing", next);
      setSyncing(false);
    }).catch(() => {
      if (!alive) return;
      setSyncing(false);
    });
    return () => { alive = false; };
  }, []);
  const fmt = (n: number) => formatMoney(n, "USD");

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="fp-display text-2xl">Billing</h1>
        <SyncBadge syncing={syncing} />
      </div>

      <Card tone="gold">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="fp-gold" />
            <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide">Innvil balance — all panels</p>
          </div>
          <span className="text-xs fp-safe-soft-bg fp-safe px-2.5 py-1 rounded-full flex items-center gap-1"><CheckCircle2 size={11} /> Auto-billing active</span>
        </div>
        <p className="fp-display text-4xl fp-gold">{data ? fmt(data.innvilBalance) : "—"}</p>
        <p className="fp-text-faint text-xs mt-1">Your available Innvil balance across every panel you own — drawn down automatically as orders complete.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          <div className="fp-panel-raised rounded-xl p-4 border fp-line-soft">
            <p className="fp-text-faint text-xs fp-mono uppercase">Revenue today (all panels)</p>
            <p className="fp-display text-xl mt-1">{data ? fmt(data.revenueToday) : "—"}</p>
          </div>
          <div className="fp-panel-raised rounded-xl p-4 border fp-line-soft">
            <p className="fp-text-faint text-xs fp-mono uppercase">Commission today (est.)</p>
            <p className="fp-display text-xl mt-1 fp-violet">{data ? fmt(data.commissionToday) : "—"}</p>
          </div>
          <div className="fp-panel-raised rounded-xl p-4 border fp-line-soft">
            <p className="fp-text-faint text-xs fp-mono uppercase">Commission charged</p>
            <p className="fp-display text-xl mt-1 fp-gold">{data ? fmt(data.commissionCharged) : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-6">
          <button onClick={onAddFunds} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm">
            <Plus size={15} /> Add funds
          </button>
          <button disabled className="fp-panel-raised border fp-line-soft px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm fp-text-faint opacity-50 cursor-not-allowed">
            <History size={15} /> History
          </button>
          <span className="text-xs fp-text-faint flex items-center gap-1 ml-auto">
            <HelpCircle size={13} /> 5% on completed orders — no monthly rent
          </span>
        </div>
        <p className="fp-text-faint text-[11px] mt-4 leading-relaxed">
          Commission settles automatically: 5% of each completed order is drawn from your prepaid Innvil
          balance. <span className="fp-text">Commission today</span> is an estimate of what today&apos;s revenue
          will settle to; <span className="fp-text">Commission charged</span> is what&apos;s actually been
          deducted so far. If a panel&apos;s balance runs out it pauses new orders until you top up. Your
          provider is billed by you directly — Innvil never touches that relationship.
        </p>
        <p className="fp-text-faint text-[11px] mt-2 leading-relaxed">
          <span className="fp-gold">Selling in volume?</span> The 5% drops as you grow — a panel doing 1,000+
          completed orders/day can contact Innvil support for a lower rate (as low as 1%). Innvil never takes
          more than $100 from one panel in a day.
        </p>
      </Card>

      <Card title="By panel today" icon={ListOrdered}>
        {!data || data.perPanel.length === 0 ? (
          <p className="fp-text-faint text-sm py-4 text-center">No panels yet.</p>
        ) : (
          data.perPanel.map((p) => (
            <div key={p.panelId} className="flex items-center justify-between border-b fp-line-soft last:border-0 py-3">
              <div>
                <p className="text-sm">{p.panelName}</p>
                <p className="fp-text-faint text-xs">
                  Commission today: {fmt(p.commissionToday)} · charged: {fmt(p.commissionCharged)}
                </p>
              </div>
              <span className="fp-mono text-sm">{fmt(p.innvilBalance)}</span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

/* ---------------- Contact Innvil support ---------------- */
export function OwnerContactSupport() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [inboxVersion, setInboxVersion] = useState(0);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await sendOwnerSupportMessage(subject, body);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Sent in Innvil. Email will only alert you when a reply is waiting here." });
    setSubject("");
    setBody("");
    setInboxVersion((version) => version + 1);
  };

  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border";

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-3xl">
      <h1 className="fp-display text-2xl">Contact support</h1>

      <Card title="Message the Innvil team" icon={LifeBuoy}>
        <p className="fp-text-dim text-sm mb-4 leading-relaxed">
          Questions about billing, a panel, or anything else? Send us a message and we&apos;ll reply here in Innvil.
          Email only alerts you when a new reply is waiting. This is separate from your customers&apos; tickets.
        </p>
        <label className="fp-text-dim text-xs fp-mono uppercase">Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What do you need help with?" className={`${inputCls} mt-1.5 mb-3`} maxLength={200} />
        <label className="fp-text-dim text-xs fp-mono uppercase">Message</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Describe your question or issue…" className={`${inputCls} mt-1.5 mb-3 resize-y`} maxLength={5000} />
        {msg && (
          <p className={`text-xs flex items-center gap-1.5 mb-3 ${msg.error ? "text-red-400" : "fp-safe"}`}>
            {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
          </p>
        )}
        <button onClick={submit} disabled={busy} className="fp-btn-primary font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 text-sm disabled:opacity-60">
          <Send size={15} /> {busy ? "Sending…" : "Send message"}
        </button>
      </Card>

      <PlatformSupportInbox key={inboxVersion} viewer="owner" />
    </div>
  );
}

/* ---------------- Panel Support (super admin only — manage owner messages) ---------------- */
export function OwnerPanelSupport() {
  const [contacts, setContacts] = useState<InnvilOwnerContact[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [outSubject, setOutSubject] = useState("");
  const [outBody, setOutBody] = useState("");
  const [outBusy, setOutBusy] = useState(false);
  const [outMsg, setOutMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [inboxVersion, setInboxVersion] = useState(0);

  const loadContacts = () => listInnvilOwnerContacts().then((r) => {
    setContacts(r);
    if (!contactId && r.length > 0) setContactId(r[0].ownerId);
  }).catch(() => setContacts([]));
  useEffect(() => { loadContacts(); }, []);

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
    setOutMsg({ text: "Message sent in Innvil. Email only alerts the customer that it is waiting." });
    setOutSubject("");
    setOutBody("");
    setInboxVersion((version) => version + 1);
  };

  const sendAutomated = async () => {
    if (outBusy) return;
    setOutBusy(true);
    setOutMsg(null);
    const res = await runDraftOnboardingSweep();
    setOutBusy(false);
    setOutMsg({ text: `Automated outreach sent: ${res.initialSent} initial, ${res.followupsSent} follow-up.` });
  };

  const selectedContact = (contacts ?? []).find((c) => c.ownerId === contactId) ?? null;

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between"><h1 className="fp-display text-2xl">Panel Support</h1></div>
      <p className="fp-text-dim text-sm">
        Messages from panel owners contacting Innvil. Reply in the conversation; email only alerts the recipient that a message is waiting.
      </p>

      <Card title="Contact Innvil customers" icon={Send}>
        <p className="fp-text-faint text-xs mb-3">
          Send direct onboarding/help messages to panel owners, including newly created draft-only customers.
        </p>
        {contacts === null ? (
          <p className="fp-text-faint text-sm py-2">Loading customers…</p>
        ) : contacts.length === 0 ? (
          <p className="fp-text-faint text-sm py-2">No panel owners found yet.</p>
        ) : (
          <div className="space-y-3">
            <label className="fp-text-dim text-xs fp-mono uppercase">Customer</label>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border">
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
            <input value={outSubject} onChange={(e) => setOutSubject(e.target.value)} placeholder="Need help launching your panel?" className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border" maxLength={200} />
            <label className="fp-text-dim text-xs fp-mono uppercase">Message</label>
            <textarea value={outBody} onChange={(e) => setOutBody(e.target.value)} rows={4} placeholder="Hi — we can guide you through setup and launch if you need help." className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border resize-y" maxLength={5000} />
            <p className="fp-text-faint text-xs">Leave subject/message blank to send the default onboarding message shown above as a placeholder.</p>
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
              <button onClick={loadContacts} className="text-xs fp-gold">Refresh list</button>
            </div>
            <p className="fp-text-faint text-xs">Delivered to the owner&apos;s in-app Contact support inbox (not email). Daily automatic follow-up also runs for still-draft owners.</p>
          </div>
        )}
      </Card>

      <PlatformSupportInbox key={inboxVersion} viewer="innvil" />
    </div>
  );
}
