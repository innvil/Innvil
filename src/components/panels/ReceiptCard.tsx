"use client";

import React, { useMemo, useState } from "react";
import { FileText, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Card } from "@/src/components/ui";
import { formatMoney } from "@/src/lib/money";
import { getOwnerReceipt, type OwnerReceipt } from "@/src/lib/actions/admin-orders";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const fmt = (n: number) => formatMoney(n, "USD");

export function ReceiptCard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [from, setFrom] = useState<number | null>(null); // day of month
  const [to, setTo] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<OwnerReceipt | null>(null);
  const [busy, setBusy] = useState(false);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const cells = useMemo(() => {
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [firstWeekday, daysInMonth]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setFrom(null); setTo(null); setReceipt(null);
  };

  const pickDay = (d: number) => {
    setReceipt(null);
    if (from === null || (from !== null && to !== null)) { setFrom(d); setTo(null); return; }
    if (d < from) { setFrom(d); return; }
    setTo(d);
  };

  const inRange = (d: number) => from !== null && to !== null && d >= from && d <= to;
  const isEdge = (d: number) => d === from || d === to;

  const rangeLabel = from
    ? `${MONTHS[month]} ${from}${to && to !== from ? `–${to}` : ""}, ${year}`
    : "Pick a start and end day";

  const generate = async () => {
    if (from === null) return;
    const endDay = to ?? from;
    const fromISO = new Date(year, month, from, 0, 0, 0, 0).toISOString();
    const toISO = new Date(year, month, endDay, 23, 59, 59, 999).toISOString();
    setBusy(true);
    const r = await getOwnerReceipt(fromISO, toISO);
    setReceipt(r);
    setBusy(false);
  };

  const download = () => {
    if (!receipt) return;
    const period = `${MONTHS[month]} ${from}${to && to !== from ? `–${to}` : ""}, ${year}`;
    const rows = receipt.perPanel
      .map((p) => `<tr><td>${p.panelName}</td><td style="text-align:right">${fmt(p.topUps)}</td><td style="text-align:right">${fmt(p.apiCost)}</td><td style="text-align:right">${fmt(p.profit)}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Innvil receipt — ${period}</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#0E1522;max-width:640px;margin:32px auto;padding:0 20px}
h1{font-size:20px;margin:0 0 4px}.muted{color:#71717a;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
th,td{padding:8px 6px;border-bottom:1px solid #e4e4e7;text-align:left}th{color:#71717a;font-weight:600;font-size:12px;text-transform:uppercase}
.totals{margin-top:20px;font-size:14px}.totals div{display:flex;justify-content:space-between;padding:6px 0}
.profit{font-size:18px;font-weight:700;border-top:2px solid #0E1522;margin-top:6px;padding-top:10px}</style></head>
<body><h1>Innvil earnings receipt</h1><p class="muted">Period: ${period} · Generated ${new Date().toLocaleString()}</p>
<table><thead><tr><th>Panel</th><th style="text-align:right">Top-ups</th><th style="text-align:right">API cost</th><th style="text-align:right">Profit</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#71717a">No activity in this period</td></tr>'}</tbody></table>
<div class="totals">
<div><span>Total top-ups (${receipt.depositCount} deposits)</span><span>${fmt(receipt.topUps)}</span></div>
<div><span>Total API cost (${receipt.orderCount} orders)</span><span>−${fmt(receipt.apiCost)}</span></div>
<div class="profit"><span>Profit</span><span>${fmt(receipt.profit)}</span></div>
</div></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `innvil-receipt-${year}-${String(month + 1).padStart(2, "0")}-${String(from).padStart(2, "0")}_to_${String(to ?? from).padStart(2, "0")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card title="Earnings receipt" icon={FileText}>
      <p className="fp-text-dim text-sm mb-4">Pick a start and end day, then generate a downloadable receipt: total top-ups minus API cost = your profit for the period.</p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Calendar */}
        <div className="fp-panel-raised border fp-line-soft rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => shiftMonth(-1)} className="fp-text-dim hover:fp-text p-1"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium">{MONTHS[month]} {year}</span>
            <button onClick={() => shiftMonth(1)} className="fp-text-dim hover:fp-text p-1"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w, i) => <span key={i} className="fp-text-faint text-[10px] fp-mono py-1">{w}</span>)}
            {cells.map((d, i) => d === null ? <span key={i} /> : (
              <button
                key={i}
                onClick={() => pickDay(d)}
                className={`text-xs py-1.5 rounded-md transition-colors ${
                  isEdge(d) ? "fp-gold-bg text-[#0A0B0F] font-semibold"
                  : inRange(d) ? "fp-gold-soft-bg fp-gold"
                  : "fp-text-dim hover:fp-panel"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div>
          <p className="fp-text-faint text-xs fp-mono uppercase mb-1">Selected period</p>
          <p className="text-sm mb-4">{rangeLabel}</p>
          <button onClick={generate} disabled={busy || from === null} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
            {busy ? "Calculating…" : "Generate receipt"}
          </button>

          {receipt && (
            <div className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between"><span className="fp-text-dim">Top-ups ({receipt.depositCount})</span><span className="fp-mono">{fmt(receipt.topUps)}</span></div>
              <div className="flex justify-between"><span className="fp-text-dim">API cost ({receipt.orderCount})</span><span className="fp-mono">−{fmt(receipt.apiCost)}</span></div>
              <div className="flex justify-between border-t fp-line-soft pt-2 mt-1"><span className="font-medium">Profit</span><span className="fp-mono fp-gold text-base">{fmt(receipt.profit)}</span></div>
              <button onClick={download} className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim hover:fp-gold-border flex items-center gap-1.5 mt-3">
                <Download size={13} /> Download receipt
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
