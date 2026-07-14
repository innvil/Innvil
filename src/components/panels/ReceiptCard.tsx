"use client";

import React, { useMemo, useState } from "react";
import { FileText, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Card } from "@/src/components/ui";
import { formatMoney } from "@/src/lib/money";
import { getOwnerReceipt, type OwnerReceipt } from "@/src/lib/actions/admin-orders";
import { jsPDF } from "jspdf";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const fmt = (n: number) => formatMoney(n, "USD");
const BUSINESS_INFO = {
  legalName: "INNVIL SOFTWARE PUBLISHING",
  address: "MONGPONG, CITY OF ROXAS, CAPIZ - REGION VI (WESTERN VISAYAS)",
  registrant: "KEGGI GLENN SALUKAN CAWIE",
  businessNameNo: "8338762",
};
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

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
    const generatedAt = new Date();
    const receiptNo = `ER-${generatedAt.getFullYear()}${String(month + 1).padStart(2, "0")}${String(to ?? from).padStart(2, "0")}-${String(generatedAt.getTime()).slice(-6)}`;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const left = 44;
    const right = pageWidth - 44;
    let y = 42;

    const ensureRoom = (needed = 20) => {
      if (y + needed <= pageHeight - 46) return;
      doc.addPage();
      y = 42;
    };

    const line = (text: string, x: number, align: "left" | "right" = "left") => {
      ensureRoom(16);
      doc.text(text, x, y, { align });
      y += 16;
    };

    const drawPair = (label: string, value: string, isDeduction = false) => {
      ensureRoom(18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(45, 45, 45);
      doc.text(label, left, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(isDeduction ? 120 : 18, isDeduction ? 30 : 18, isDeduction ? 30 : 18);
      doc.text(value, right, y, { align: "right" });
      y += 18;
    };

    doc.setFillColor(246, 246, 248);
    doc.roundedRect(left, y, right - left, 96, 8, 8, "F");
    y += 22;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(17, 24, 39);
    doc.text(BUSINESS_INFO.legalName, left + 12, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(70, 70, 70);
    y += 16;
    doc.text(BUSINESS_INFO.address, left + 12, y);
    y += 14;
    doc.text(`Registered to: ${BUSINESS_INFO.registrant}`, left + 12, y);
    y += 14;
    doc.text(`Business Name No.: ${BUSINESS_INFO.businessNameNo}`, left + 12, y);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(17, 24, 39);
    doc.text("EARNINGS RECEIPT", right - 12, 64, { align: "right" });

    y += 20;
    doc.setDrawColor(220, 220, 220);
    doc.line(left, y, right, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    line(`Receipt no: ${receiptNo}`, left);
    line(`Generated at: ${generatedAt.toLocaleString()}`, left);
    line(`Covered period: ${period}`, left);

    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(22, 22, 22);
    line("Top-up transactions", left);

    ensureRoom(24);
    doc.setFillColor(251, 251, 251);
    doc.rect(left, y - 11, right - left, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(95, 95, 95);
    doc.text("Date & time", left + 6, y + 3);
    doc.text("Description", left + 190, y + 3);
    doc.text("Amount", right - 6, y + 3, { align: "right" });
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(25, 25, 25);
    if (!receipt.topUpRows.length) {
      ensureRoom(18);
      doc.text("No top-ups in this period.", left + 6, y);
      y += 18;
    } else {
      for (const row of receipt.topUpRows) {
        ensureRoom(18);
        doc.text(fmtDateTime(row.createdAt), left + 6, y);
        doc.text("Top-up (cash-in)", left + 190, y);
        doc.text(fmt(row.amount), right - 6, y, { align: "right" });
        y += 18;
      }
    }

    y += 10;
    doc.setDrawColor(220, 220, 220);
    doc.line(left, y, right, y);
    y += 20;

    drawPair(`Total top-ups (${receipt.depositCount})`, fmt(receipt.topUps));
    drawPair(`Total orders (${receipt.orderCount})`, `-${fmt(receipt.apiCost)}`, true);

    ensureRoom(26);
    doc.setDrawColor(184, 184, 184);
    doc.line(left, y, right, y);
    y += 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13.5);
    doc.setTextColor(16, 16, 16);
    doc.text("Net earnings", left, y);
    doc.text(fmt(receipt.profit), right, y, { align: "right" });

    y += 26;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text("Generated by Innvil earnings system.", left, y);
    doc.text(`Business Name No. ${BUSINESS_INFO.businessNameNo}`, right, y, { align: "right" });
    y += 14;
    doc.text("This document is not valid for claim of input tax.", left, y);
    y += 14;
    doc.text("This receipt serves as an official receipt and may be used for lawful legal purposes.", left, y);

    doc.save(
      `innvil-receipt-${year}-${String(month + 1).padStart(2, "0")}-${String(from).padStart(2, "0")}_to_${String(to ?? from).padStart(2, "0")}.pdf`
    );
  };

  return (
    <Card title="Earnings receipt" icon={FileText}>
      <p className="fp-text-dim text-sm mb-4">Pick a start and end day, then generate a downloadable PDF receipt with each top-up (date/time + amount) and your total orders deduction.</p>

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
              <div className="flex justify-between"><span className="fp-text-dim">Total orders ({receipt.orderCount})</span><span className="fp-mono">−{fmt(receipt.apiCost)}</span></div>
              <div className="flex justify-between border-t fp-line-soft pt-2 mt-1"><span className="font-medium">Profit</span><span className="fp-mono fp-gold text-base">{fmt(receipt.profit)}</span></div>
              <div className="mt-2 max-h-52 overflow-auto border fp-line-soft rounded-lg p-2">
                <p className="fp-text-faint text-[11px] fp-mono uppercase mb-1">Top-up breakdown</p>
                {receipt.topUpRows.length ? (
                  <div className="space-y-1.5">
                    {receipt.topUpRows.map((row, idx) => (
                      <div key={`${row.createdAt}-${idx}`} className="flex items-start justify-between gap-3 text-xs">
                        <span className="fp-text-dim">{fmtDateTime(row.createdAt)} · Top-up (cash-in)</span>
                        <span className="fp-mono">{fmt(row.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="fp-text-dim text-xs">No top-ups in this period.</p>
                )}
              </div>
              <button onClick={download} className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim hover:fp-gold-border flex items-center gap-1.5 mt-3">
                <Download size={13} /> Download PDF receipt
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
