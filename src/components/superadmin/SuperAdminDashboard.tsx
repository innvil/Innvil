"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, LayoutGrid, CreditCard, CheckCircle2, AlertTriangle, Lock, ArrowLeft, Wallet,
} from "lucide-react";
import { Card, StatCard, Pill } from "@/src/components/ui";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import {
  getPlatformOverview, listPanelsForSuperAdmin, adjustPanelBalance,
  type PlatformOverview, type SuperAdminPanelVM,
} from "@/src/lib/actions/superadmin";
import {
  getPlatformPaymentsMeta, connectPlatformGateway, disconnectPlatformGateway,
  getPlatformTopupDiscountDefaults, setPlatformTopupDiscountDefaults,
  type PlatformGatewayMeta, type PaymentDiscountCategory,
} from "@/src/lib/actions/platform-payments";

const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-1.5 outline-none focus:fp-gold-border";

/* ---------------- Overview ---------------- */
function OverviewTab() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getPlatformOverview()
      .then((next) => {
        if (!alive) return;
        setData(next);
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard label="Panels" value={data ? String(data.panels) : "—"} tone="gold" />
      <StatCard label="Live panels" value={data ? String(data.livePanels) : "—"} />
      <StatCard label="Panel owners" value={data ? String(data.owners) : "—"} />
      <StatCard label="Customers" value={data ? String(data.customers) : "—"} />
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

  return (
    <div className="space-y-5">
      <p className="fp-text-dim text-sm">
        Manage panel balances directly for payment correction cases. Credits and debits are audit-logged.
      </p>
      {notice && <p className="text-xs fp-safe flex items-center gap-1.5"><CheckCircle2 size={12} /> {notice}</p>}
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

      {rows === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">No panels found.</p>
      ) : (
        <div className="fp-panel border fp-line rounded-2xl p-4 overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
                <th className="py-2 font-normal">Panel</th>
                <th className="py-2 font-normal">Owner</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal text-right">Innvil balance</th>
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

/* ---------------- Shell ---------------- */
const TABS = [
  { k: "overview", label: "Overview", icon: LayoutGrid },
  { k: "panels", label: "Panels", icon: Wallet },
  { k: "payments", label: "Platform payments", icon: CreditCard },
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
      </div>
    </div>
  );
}
