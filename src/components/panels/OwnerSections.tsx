"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ListOrdered, Users, Wallet, Plus, History, HelpCircle, RefreshCw, AlertTriangle, Wifi, CheckCircle2, LifeBuoy, Send } from "lucide-react";
import { Card, Pill } from "@/src/components/ui";
import { formatMoney } from "@/src/lib/money";
import { listAllOwnerOrders, getOwnerBillingSummary, type OwnerOrderVM, type OwnerBillingSummary } from "@/src/lib/actions/admin-orders";
import { sendOwnerSupportMessage, listOwnerSupportMessages, listPlatformSupportMessages, setPlatformSupportStatus, type PlatformSupportMessage } from "@/src/lib/actions/platform-support";
import { listAllOwnerCustomers, adjustCustomerBalance, type OwnerCustomerVM } from "@/src/lib/actions/customers";
import { listAllOwnerProviders, fetchProviderBalance, type OwnerProviderVM } from "@/src/lib/actions/providers";
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
  const [history, setHistory] = useState<PlatformSupportMessage[] | null>(null);

  const load = () => listOwnerSupportMessages().then(setHistory).catch(() => setHistory([]));
  useEffect(() => { load(); }, []);

  const fmtDate = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await sendOwnerSupportMessage(subject, body);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Sent — the Innvil team will get back to you by email." });
    setSubject("");
    setBody("");
    load();
  };

  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border";

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-3xl">
      <h1 className="fp-display text-2xl">Contact support</h1>

      <Card title="Message the Innvil team" icon={LifeBuoy}>
        <p className="fp-text-dim text-sm mb-4 leading-relaxed">
          Questions about billing, a panel, or anything else? Send us a message and we&apos;ll reply to your
          account email. This goes straight to Innvil — it&apos;s separate from your customers&apos; tickets.
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

      <Card title="Your messages" icon={History}>
        {history === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>
        ) : history.length === 0 ? (
          <p className="fp-text-faint text-sm py-4 text-center">You haven&apos;t contacted support yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((m) => (
              <details key={m.id} className="fp-panel-raised border fp-line-soft rounded-xl px-4 py-3 group">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                  <span className="text-sm font-medium truncate">{m.subject}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Pill tone={m.status === "resolved" ? "safe" : "muted"}>{m.status === "resolved" ? "Resolved" : "Open"}</Pill>
                    <span className="fp-text-faint text-xs fp-mono">{fmtDate(m.createdAt)}</span>
                  </span>
                </summary>
                <p className="fp-text-dim text-sm mt-2 leading-relaxed whitespace-pre-line">{m.body}</p>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Panel Support (super admin only — manage owner messages) ---------------- */
export function OwnerPanelSupport() {
  const [rows, setRows] = useState<PlatformSupportMessage[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => listPlatformSupportMessages().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const fmtDate = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const setStatus = async (id: string, status: "open" | "resolved") => {
    setBusyId(id);
    const res = await setPlatformSupportStatus(id, status);
    setBusyId(null);
    if (res.ok) setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
  };

  const openCount = (rows ?? []).filter((r) => r.status !== "resolved").length;

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="fp-display text-2xl">Panel Support</h1>
        <button onClick={load} className="text-xs fp-gold">Refresh</button>
      </div>
      <p className="fp-text-dim text-sm">
        Messages from panel owners contacting Innvil. {openCount > 0 && <span className="fp-gold">{openCount} open.</span>}{" "}
        Reply by email or mark resolved. The support destination email is set under <span className="fp-text">/superadmin → Support</span>.
      </p>

      <Card title="Owner messages" icon={LifeBuoy}>
        {rows === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="fp-text-faint text-sm py-4 text-center">No support messages yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((m) => (
              <div key={m.id} className="fp-panel-raised border fp-line-soft rounded-xl p-4">
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
      </Card>
    </div>
  );
}
