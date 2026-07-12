"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, LayoutGrid, CreditCard, CheckCircle2, AlertTriangle, Lock, ArrowLeft,
} from "lucide-react";
import { Card, StatCard, Pill } from "@/src/components/ui";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import { getPlatformOverview, type PlatformOverview } from "@/src/lib/actions/superadmin";
import {
  getPlatformPaymentsMeta, connectPlatformGateway, disconnectPlatformGateway,
  type PlatformGatewayMeta,
} from "@/src/lib/actions/platform-payments";

const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-1.5 outline-none focus:fp-gold-border";

/* ---------------- Overview ---------------- */
function OverviewTab() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  useEffect(() => { getPlatformOverview().then(setData); }, []);
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
  const load = () => getPlatformPaymentsMeta().then(setMeta);
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="fp-text-dim text-sm">
        These are the methods <span className="fp-text">panel owners</span> use to pay Innvil (top up their
        commission balance). Credentials are encrypted and never leave the server. Binance Pay is coming later.
      </p>
      {meta === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : (
        <div className="grid gap-4">
          {meta.map((g) => <GatewayCard key={g.id} g={g} onSaved={load} />)}
        </div>
      )}
    </div>
  );
}

/* ---------------- Shell ---------------- */
const TABS = [
  { k: "overview", label: "Overview", icon: LayoutGrid },
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
        {tab === "payments" && <PaymentsTab />}
      </div>
    </div>
  );
}
