"use client";

import React, { useEffect, useState } from "react";
import { ListOrdered, Users, Wallet, Plus, History, HelpCircle, RefreshCw } from "lucide-react";
import { Card, Pill } from "@/src/components/ui";
import { formatMoney } from "@/src/lib/money";
import { listAllOwnerOrders, getOwnerBillingSummary, type OwnerOrderVM, type OwnerBillingSummary } from "@/src/lib/actions/admin-orders";
import { listAllOwnerCustomers, type OwnerCustomerVM } from "@/src/lib/actions/customers";

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
                    <td className="py-2.5"><Pill tone={STATUS_TONE[o.status] ?? "muted"}>{STATUS_LABEL[o.status] ?? o.status}</Pill></td>
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
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b fp-line-soft last:border-0">
                    <td className="py-2.5">{c.email ?? "—"}</td>
                    <td className="py-2.5 fp-text-dim">{c.panelName}</td>
                    <td className="py-2.5 text-right fp-mono">{c.orders}</td>
                    <td className="py-2.5 text-right fp-mono">{fmt(c.spent)}</td>
                    <td className="py-2.5 text-right fp-mono">{fmt(c.balance)}</td>
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
