"use client";

import React, { useState, ReactNode } from "react";
import { CheckCircle2, Circle, Clock, Lock, Settings, Wrench, FileText, TrendingUp, ChevronDown, ListOrdered, LucideIcon } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { PANEL_STATUSES, revenueData, PanelStatus } from "@/src/data/constants";

/* =========================================================
   UI COMPONENTS
   ========================================================= */

/**
 * Pill - Small label/badge component
 */
export function Pill({
  children,
  tone = "gold",
  icon: Icon
}: {
  children: ReactNode;
  tone?: "gold" | "violet" | "safe" | "danger" | "muted";
  icon?: LucideIcon;
}) {
  const toneClasses = {
    gold: "fp-gold-soft-bg fp-gold",
    violet: "fp-violet-soft-bg fp-violet",
    safe: "fp-safe-soft-bg fp-safe",
    danger: "bg-red-500/10 text-red-400",
    muted: "fp-panel-raised fp-text-dim",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium fp-mono ${toneClasses[tone]}`}>
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}

/**
 * StatusBadge - Displays panel status with icon
 */
export function StatusBadge({ status }: { status: "draft" | "live" | "inactive" | "suspended" | "maintenance" }) {
  const iconMap: Record<string, LucideIcon> = {
    live: CheckCircle2,
    draft: FileText,
    inactive: Clock,
    suspended: Lock,
    maintenance: Wrench,
  };
  const Icon = iconMap[status] || Circle;

  const statusClasses: Record<string, string> = {
    live: "fp-safe-soft-bg fp-safe",
    draft: "fp-panel-raised fp-text-dim",
    inactive: "fp-gold-soft-bg fp-gold",
    suspended: "bg-red-500/10 text-red-400",
    maintenance: "fp-violet-soft-bg fp-violet",
  };

  const statusLabels: Record<string, string> = {
    live: "Live",
    draft: "Draft",
    inactive: "Inactive Mode",
    suspended: "Suspended",
    maintenance: "Maintenance",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium fp-mono ${statusClasses[status] || statusClasses.draft}`}>
      <Icon size={11} />
      {statusLabels[status] || "Draft"}
    </span>
  );
}

/**
 * StatusDropdown - Dropdown for changing panel status
 */
export function StatusDropdown({
  currentStatus,
  onChange,
}: {
  currentStatus: "draft" | "live" | "inactive" | "suspended" | "maintenance";
  onChange: (status: "draft" | "live" | "inactive" | "suspended" | "maintenance") => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed fp-line-soft hover:fp-gold-border transition-colors"
      >
        <StatusBadge status={currentStatus} />
        <ChevronDown size={12} className="fp-text-faint" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 fp-panel border fp-line rounded-xl shadow-2xl z-50 overflow-hidden">
          {(Object.entries(PANEL_STATUSES) as [PanelStatus, typeof PANEL_STATUSES[PanelStatus]][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => { onChange(key); setOpen(false); }}
              className={`w-full text-left px-4 py-3 hover:fp-gold-soft-bg transition-colors ${currentStatus === key ? "bg-[rgba(201,165,116,0.08)]" : ""}`}
            >
              <div className="flex items-center justify-between">
                <StatusBadge status={key} />
              </div>
              <p className="text-xs fp-text-dim mt-1 leading-relaxed">{cfg.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Toggle - On/off switch component
 */
export function Toggle({ on }: { on: boolean }) {
  return (
    <div className="fp-toggle" style={{ background: on ? "rgba(201,165,116,0.85)" : "#262A35" }}>
      <div className="fp-toggle-dot" style={{ left: on ? 17 : 3 }} />
    </div>
  );
}

/**
 * Card - Container with optional title and header
 */
export function Card({
  title,
  icon: Icon,
  right,
  children,
  tone = "line",
}: {
  title?: string;
  icon?: LucideIcon;
  right?: ReactNode;
  children: ReactNode;
  tone?: "gold" | "violet" | "safe" | "line";
}) {
  const border = tone === "gold" ? "fp-gold-border" : tone === "violet" ? "fp-violet-border" : tone === "safe" ? "fp-safe-border" : "fp-line";
  return (
    <div className={`fp-panel border ${border} rounded-2xl p-6`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={16} className="fp-gold" />}
            {title && <p className="fp-display text-lg">{title}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * StatCard - Display a metric with label
 */
export function StatCard({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "gold" | "safe";
}) {
  return (
    <div className="fp-panel border fp-line rounded-2xl p-5">
      <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide">{label}</p>
      <div className="flex items-end justify-between mt-2">
        <p className="fp-display text-2xl">{value}</p>
        {delta && (
          <span className={`text-xs fp-mono flex items-center gap-0.5 ${tone === "gold" ? "fp-gold" : "fp-safe"}`}>
            <TrendingUp size={12} /> {delta}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * FloorLedger - Visualizes the price floor concept
 */
export function FloorLedger({ compact = false }: { compact?: boolean }) {
  const floor = 34;
  const price = 74;

  return (
    <div className={`fp-panel border fp-line rounded-2xl ${compact ? "p-5" : "p-7"}`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="fp-text-faint text-xs uppercase tracking-[0.14em] fp-mono">Floor ledger</p>
          <p className="fp-display text-lg mt-1">Instagram Followers — 1,000</p>
        </div>
        <Pill tone="safe" icon={CheckCircle2}>Compliant</Pill>
      </div>
      <div className="flex gap-6 items-end">
        <div
          className="relative flex-1 h-40 rounded-xl border fp-line-soft overflow-hidden"
          style={{ background: "linear-gradient(180deg, rgba(139,127,255,0.10), rgba(201,165,116,0.06))" }}
        >
          <div
            className="absolute left-0 right-0 border-t-2 fp-gold-border"
            style={{ bottom: `${floor}%` }}
          >
            <span className="absolute -top-6 left-3 text-[11px] fp-mono fp-gold">your provider&apos;s floor · $0.90</span>
          </div>
          <div
            className="absolute left-0 right-0 border-t-2"
            style={{ bottom: `${price}%`, borderStyle: "dashed", borderColor: "rgba(139,127,255,0.35)" }}
          >
            <span className="absolute top-2 left-3 text-[11px] fp-mono fp-violet">your price · $1.35</span>
          </div>
          <div
            className="absolute left-0 right-0 fp-violet-soft-bg"
            style={{ bottom: `${floor}%`, height: `${price - floor}%` }}
          />
        </div>
        <div className="w-36 shrink-0">
          <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide">Your margin</p>
          <p className="fp-display text-3xl fp-safe mt-1">+50%</p>
          <p className="fp-text-dim text-xs mt-3 leading-relaxed">
            Price can move anywhere above the floor your provider sets. Never below it.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * RevenueChart - Area chart showing revenue over time
 */
export function RevenueChart({
  title = "Last 6 months",
  data,
}: {
  title?: string;
  data?: Array<{ m: string; v: number }>;
}) {
  const chartData = data || revenueData;

  return (
    <Card
      title="Revenue"
      icon={TrendingUp}
      right={<Pill tone="gold" icon={TrendingUp}>+48% MoM</Pill>}
    >
      <p className="fp-display text-xl -mt-3 mb-4">{title}</p>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="goldFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C9A574" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#C9A574" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1E212A" vertical={false} />
            <XAxis
              dataKey="m"
              stroke="#5C5F6B"
              tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              stroke="#5C5F6B"
              tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1B1E27",
                border: "1px solid #262A35",
                borderRadius: 10,
                fontFamily: "IBM Plex Mono",
                fontSize: 12,
              }}
              labelStyle={{ color: "#9497A3" }}
            />
            <Area type="monotone" dataKey="v" stroke="#C9A574" strokeWidth={2} fill="url(#goldFade)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/**
 * OrdersTable - Displays recent orders in a table
 */
export function OrdersTable() {
  const { recentOrders } = require("@/src/data/constants");
  const tone: Record<string, "safe" | "gold" | "violet"> = {
    Completed: "safe",
    Processing: "gold",
    Queued: "violet",
  };

  return (
    <Card title="Recent orders" icon={ListOrdered}>
      <table className="w-full text-sm">
        <thead>
          <tr className="fp-text-faint text-xs fp-mono uppercase text-left border-b fp-line-soft">
            <th className="py-2 font-normal">ID</th>
            <th className="py-2 font-normal">Service</th>
            <th className="py-2 font-normal">Qty</th>
            <th className="py-2 font-normal">Customer</th>
            <th className="py-2 font-normal">Amount</th>
            <th className="py-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {recentOrders.map((o: any) => (
            <tr key={o.id} className="border-b fp-line-soft last:border-0">
              <td className="py-3 fp-mono fp-text-dim">#{o.id}</td>
              <td className="py-3">{o.service}</td>
              <td className="py-3 fp-mono">{o.qty}</td>
              <td className="py-3 fp-text-dim">{o.customer}</td>
              <td className="py-3 fp-mono">{o.amount}</td>
              <td className="py-3"><Pill tone={tone[o.status] || "muted"}>{o.status}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
