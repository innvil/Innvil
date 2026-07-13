"use client";

import React, { useEffect, useRef, useState } from "react";
import { ListOrdered, Users, Wallet, Plus, History, HelpCircle, RefreshCw, AlertTriangle, Wifi } from "lucide-react";
import { Card, Pill } from "@/src/components/ui";
import { formatMoney } from "@/src/lib/money";
import { listAllOwnerOrders, getOwnerBillingSummary, type OwnerOrderVM, type OwnerBillingSummary } from "@/src/lib/actions/admin-orders";
import { listAllOwnerCustomers, adjustCustomerBalance, type OwnerCustomerVM } from "@/src/lib/actions/customers";
import { listAllOwnerProviders, fetchProviderBalance, type OwnerProviderVM } from "@/src/lib/actions/providers";

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
const ownerSectionMemory = new Map<string, unknown>();

function getOwnerCacheKey(section: string) {
  return `${OWNER_CACHE_PREFIX}:${section}`;
}

function readOwnerCache<T>(section: string): T | null {
  const key = getOwnerCacheKey(section);
  if (ownerSectionMemory.has(key)) return ownerSectionMemory.get(key) as T;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
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
  partial: "gold", canceled: "muted", failed: "muted", refunded: "muted",
};
const STATUS_LABEL: Record<string, string> = {
  completed: "Completed", processing: "Processing", in_progress: "In progress",
  pending: "Pending", partial: "Partial", canceled: "Canceled", failed: "Failed", refunded: "Refunded",
};

/* ---------- Orders across all panels ---------- */
export function OwnerOrders() {
  const cachedRows = readOwnerCache<OwnerOrderVM[]>("orders");
  const [rows, setRows] = useState<OwnerOrderVM[] | null>(cachedRows);
  const [syncing, setSyncing] = useState(Boolean(cachedRows));
  useEffect(() => {
    let alive = true;
    setSyncing(rows !== null);
    listAllOwnerOrders().then((next) => {
      if (!alive) return;
      setRows(next);
      writeOwnerCache("orders", next);
      setSyncing(false);
    }).catch(() => {
      if (!alive) return;
      setSyncing(false);
    });
    return () => { alive = false; };
  }, []);
  const fmt = (n: number) => formatMoney(n, "USD");

  return (
    <div className="p-8">
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
                  <th className="py-2 font-normal text-right">Charge</th>
                  <th className="py-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b fp-line-soft last:border-0">
                    <td className="py-2.5 fp-mono fp-text-dim">#{o.shortId}</td>
                    <td className="py-2.5">{o.panelName}</td>
                    <td className="py-2.5">{o.serviceName}</td>
                    <td className="py-2.5 fp-text-dim">{o.customerEmail ?? "—"}</td>
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
export function OwnerCustomers() {
  const cachedRows = readOwnerCache<OwnerCustomerVM[]>("customers");
  const [rows, setRows] = useState<OwnerCustomerVM[] | null>(cachedRows);
  const [syncing, setSyncing] = useState(Boolean(cachedRows));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setSyncing(rows !== null);
    listAllOwnerCustomers().then((next) => {
      if (!alive) return;
      setRows(next);
      writeOwnerCache("customers", next);
      setSyncing(false);
    }).catch(() => {
      if (!alive) return;
      setSyncing(false);
    });
    return () => { alive = false; };
  }, []);
  const fmt = (n: number) => formatMoney(n, "USD");

  const openRow = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
    setAmount(""); setReason(""); setMsg(null);
  };

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
    <div className="p-8">
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
                        <td className="py-2.5">{c.email ?? "—"}</td>
                        <td className="py-2.5 fp-text-dim">{c.panelName}</td>
                        <td className="py-2.5 text-right fp-mono">{c.orders}</td>
                        <td className="py-2.5 text-right fp-mono">{fmt(c.spent)}</td>
                        <td className="py-2.5 text-right fp-mono">{fmt(c.balance)}</td>
                        <td className="py-2.5 text-right"><span className="fp-gold text-xs">{open ? "Hide" : "Adjust"}</span></td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} className="pb-4">
                            <div className="fp-panel-raised border fp-line-soft rounded-lg p-4">
                              <p className="fp-text-faint text-[11px] fp-mono uppercase mb-3">Adjust balance · {c.email ?? "customer"} · {c.panelName}</p>
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
    <div className="p-8">
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
          <span className="text-xs fp-gold-soft-bg fp-gold px-2.5 py-1 rounded-full">Auto-billing coming soon</span>
        </div>
        <p className="fp-display text-4xl fp-gold">{data ? fmt(data.innvilBalance) : "—"}</p>
        <p className="fp-text-faint text-xs mt-1">Your available Innvil balance across every panel you own.</p>
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="fp-panel-raised rounded-xl p-4 border fp-line-soft">
            <p className="fp-text-faint text-xs fp-mono uppercase">Revenue today (all panels)</p>
            <p className="fp-display text-xl mt-1">{data ? fmt(data.revenueToday) : "—"}</p>
          </div>
          <div className="fp-panel-raised rounded-xl p-4 border fp-line-soft">
            <p className="fp-text-faint text-xs fp-mono uppercase">Commission today</p>
            <p className="fp-display text-xl mt-1 fp-violet">{data ? fmt(data.commissionToday) : "—"}</p>
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
          Automatic commission settlement (a prepaid Innvil balance that&apos;s drawn down as your panels sell)
          is coming soon. Amounts above are live figures from your real orders. Your provider is billed by you
          directly — Innvil never touches that relationship.
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
                <p className="fp-text-faint text-xs">Commission today: {fmt(p.commissionToday)}</p>
              </div>
              <span className="fp-mono text-sm">{fmt(p.innvilBalance)}</span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
