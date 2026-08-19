import React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, PauseCircle, X } from "lucide-react";
import type { CommunityOperationalStatus } from "@/src/lib/products/watch-status";
import type { AttentionSeverity } from "@/src/lib/products/watch-runtime";

/**
 * Shared presentational primitives for every Watch feature "world"
 * (Projects/Communities/Watchers/Activity/Usage/Billing/Settings) — kept in
 * one file so each new page doesn't re-implement its own stat card / status
 * dot / empty state, and so they stay visually consistent with the Overview
 * page that originated them.
 */

export function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function StatCard({ label, value, denominator, note, progress }: { label: string; value: string | number; denominator?: string; note?: string; progress?: number }) {
  return (
    <div className="w-card p-4">
      <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">{label}</p>
      <p className="w-display text-2xl w-text">
        {value}
        {denominator && <span className="text-sm w-text-faint font-normal"> / {denominator}</span>}
      </p>
      {note && <p className="text-xs w-text-dim mt-1">{note}</p>}
      {typeof progress === "number" && (
        <div className="h-1.5 rounded-full w-surface-raised mt-2.5 overflow-hidden">
          <div className="h-full w-teal-bg rounded-full" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
    </div>
  );
}

export function StatusDot({ on, onLabel = "Active", offLabel = "Paused" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "w-green-bg" : "w-surface-raised border w-line-soft"}`} aria-hidden="true" />
      <span className="text-xs w-text-dim">{on ? onLabel : offLabel}</span>
    </span>
  );
}

export function SectionHeader({ icon: Icon, title, action }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon size={15} className="w-teal" />
        <h2 className="w-display text-sm">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return <p className="text-sm w-text-faint py-6 text-center">{text}</p>;
}

export function CapacityRow({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="w-text-dim">{label}</span>
        <span className="w-text">{used} of {total}</span>
      </div>
      <div className="h-1.5 rounded-full w-surface-raised overflow-hidden">
        <div className="h-full w-teal-bg rounded-full" style={{ width: `${Math.min(100, (used / Math.max(1, total)) * 100)}%` }} />
      </div>
    </div>
  );
}

/** Small shared centered modal -- extracted from WatchDashboard's
 *  (previously locally-defined) Create Project/Watcher dialog so a second
 *  feature (the Persona preset picker) doesn't need its own duplicate
 *  overlay implementation. `maxWidth` defaults to the original `max-w-sm`
 *  so every existing call site is unaffected; wider consumers pass their
 *  own Tailwind max-width class. */
export function Modal({
  title, onClose, children, maxWidth = "max-w-sm",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className={`relative w-full ${maxWidth} w-card p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="w-display text-base">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Crumb({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-xs w-text-faint hover:w-text-dim">{label}</Link>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 mb-3 flex-wrap">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-xs w-text-faint">/</span>}
          {item.href ? <Crumb href={item.href} label={item.label} /> : <span className="text-xs w-text-dim">{item.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

const OPERATIONAL_STATUS_META: Record<CommunityOperationalStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  healthy: { label: "Healthy", icon: CheckCircle2, className: "w-green" },
  needs_attention: { label: "Needs attention", icon: AlertTriangle, className: "w-amber" },
  paused: { label: "Paused", icon: PauseCircle, className: "w-text-faint" },
};

/** Deterministic operational status badge — icon + text together (never
 *  color alone), reused by the Community Health table and Community detail
 *  header so the same 3-state vocabulary reads identically everywhere. */
export function OperationalStatusBadge({ status }: { status: CommunityOperationalStatus }) {
  const meta = OPERATIONAL_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.className}`}>
      <Icon size={13} /> {meta.label}
    </span>
  );
}

const SEVERITY_META: Record<AttentionSeverity, { label: string; className: string }> = {
  high: { label: "HIGH", className: "w-red w-red-soft-bg" },
  medium: { label: "MEDIUM", className: "w-amber w-amber-soft-bg" },
  low: { label: "LOW", className: "w-text-dim w-surface-raised" },
};

export function SeverityTag({ severity }: { severity: AttentionSeverity }) {
  const meta = SEVERITY_META[severity];
  return <span className={`w-pill text-[10px] font-bold tracking-wide ${meta.className}`}>{meta.label}</span>;
}

/** Real Watcher relationship visibility for a Community Health/list row —
 *  names, not just a count (shown as plain visible links, never a
 *  hover-only tooltip, so the relationship is legible without a pointer).
 *  Active deployments are listed first (the operationally relevant ones);
 *  a paused Watcher is only appended if there's room, since it's not the
 *  focus of a "health" column. */
export function WatcherNamesCell({ watchers, max = 2 }: { watchers: Array<{ watcherId: string; watcherName: string; enabled: boolean }>; max?: number }) {
  if (watchers.length === 0) return <span className="w-text-faint">None</span>;
  const ordered = [...watchers].sort((a, b) => Number(b.enabled) - Number(a.enabled));
  const shown = ordered.slice(0, max);
  const extra = ordered.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      {shown.map((w, i) => (
        <React.Fragment key={w.watcherId}>
          {i > 0 && <span className="w-text-faint">,</span>}
          <Link href={`/watchers/${w.watcherId}`} className={`hover:w-teal ${w.enabled ? "w-text" : "w-text-faint"}`}>{w.watcherName}</Link>
        </React.Fragment>
      ))}
      {extra > 0 && <span className="w-text-faint">+{extra}</span>}
    </span>
  );
}
