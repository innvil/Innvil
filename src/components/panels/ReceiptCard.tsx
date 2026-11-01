"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileText, ChevronLeft, ChevronRight, Download, Upload, Loader2, Save, Building2, AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { Card } from "@/src/components/ui";
import { formatMoney } from "@/src/lib/money";
import { getOwnerReceipt, type OwnerReceipt } from "@/src/lib/actions/admin-orders";
import { getBusinessProfile, saveBusinessProfile, type BusinessProfile } from "@/src/lib/actions/business-profile";
import { jsPDF } from "jspdf";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const fmt = (n: number) => formatMoney(n, "USD");
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const EMPTY_BIZ: BusinessProfile = {
  legalName: "", address: "", registrant: "", businessNumber: "", taxId: "", email: "", phone: "",
};

/** Best-effort field extraction from OCR'd registration text. Owner edits after. */
function parseBusinessText(text: string): Partial<BusinessProfile> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join("\n");
  const normalized = text.replace(/\s+/g, " ").trim();
  const out: Partial<BusinessProfile> = {};
  const stopName = /(documentary\s+stamp|this\s+certifies|certificate|business\s+name\s+registration|secretary|philippines|valid\s+from|testimony\s+whereof)/i;

  const lineAfter = (re: RegExp): string => {
    for (let i = 0; i < lines.length - 1; i++) {
      if (re.test(lines[i])) return lines[i + 1];
    }
    return "";
  };

  const cleanCandidate = (v: string): string => v.replace(/^[-:;\s]+|[-:;\s]+$/g, "").trim();
  const trimBusinessName = (v: string): string => {
    const compact = cleanCandidate(v).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    const cut = compact.match(/^(.*?)(?:\bBARANGAY\b|\bBRGY\.?\b|\bCITY\s+OF\b|\bMUNICIPALITY\b|\bPROVINCE\b|\bREGION\b)/i);
    const picked = cut?.[1] ? cut[1] : compact;
    return picked.replace(/[\s,.-]+$/g, "").trim();
  };

  // Common PH DTI form shape in one-line PDF text: "This certifies that <name> is a business name registered".
  const certNameInline = normalized.match(/this\s+certifies\s+that\s+(.{3,140}?)\s+is\s+a\s+business\s+name\s+registered/i);
  if (certNameInline?.[1]) {
    const candidate = trimBusinessName(certNameInline[1]);
    if (candidate && !stopName.test(candidate) && /[A-Za-z]{4,}/.test(candidate)) out.legalName = candidate;
  }

  // Common PH DTI form shape in one-line PDF text: "This certificate issued to <name> is valid from".
  const certRegistrantInline = normalized.match(/certificate\s+issued\s+to\s+(.{3,140}?)\s+is\s+valid\s+from/i);
  if (certRegistrantInline?.[1]) {
    const candidate = cleanCandidate(certRegistrantInline[1]).replace(/[()]/g, "").trim();
    if (candidate && !stopName.test(candidate) && /[A-Za-z]{4,}/.test(candidate)) out.registrant = candidate;
  }

  // Common PH DTI form shape: "This certifies that" -> business name on next line.
  const certName = cleanCandidate(lineAfter(/this\s+certifies\s+that/i));
  if (!out.legalName && certName && !stopName.test(certName) && /[A-Za-z]{4,}/.test(certName)) {
    out.legalName = trimBusinessName(certName);
  }

  // Common PH DTI form shape: "This certificate issued to" -> registrant on next line.
  const certRegistrant = cleanCandidate(lineAfter(/certificate\s+issued\s+to/i));
  if (!out.registrant && certRegistrant && !stopName.test(certRegistrant) && /[A-Za-z]{4,}/.test(certRegistrant)) {
    out.registrant = certRegistrant;
  }

  const labelIndex = lines.findIndex((l) => /(business\s*name\s*no\.?|registration\s*(?:no|number)|reg\.?\s*no|permit\s*no|company\s*(?:no|number))/i.test(l));
  if (labelIndex >= 0) {
    for (let i = labelIndex + 1; i < Math.min(lines.length, labelIndex + 5); i++) {
      const m = lines[i].match(/\b([A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]{4,})\b/);
      if (m) {
        out.businessNumber = m[1].trim();
        break;
      }
    }
  }

  if (!out.businessNumber) {
    const inlineNo = joined.match(/\b([A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]{4,})\b/);
    if (inlineNo) out.businessNumber = inlineNo[1].trim();
  }

  if (!out.businessNumber) {
    const labeledInlineNo = normalized.match(/(?:business\s*name\s*no\.?|registration\s*(?:no|number)|reg\.?\s*no)\s*[:#-]?\s*([A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]{4,})/i);
    if (labeledInlineNo) out.businessNumber = labeledInlineNo[1].trim();
  }

  const taxMatch = joined.match(/(?:\btin\b|tax\s*(?:id|identification|no)?|\bvat\b|\bein\b)[^\dA-Za-z]{0,15}([A-Z0-9][A-Z0-9-]{5,})/i);
  if (taxMatch) out.taxId = taxMatch[1].trim();

  const emailMatch = joined.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) out.email = emailMatch[0];

  // Avoid unlabeled numeric lines (e.g. business no) being treated as phone.
  const phoneLine = lines.find((l) => /(?:phone|mobile|tel\.?|telephone|contact\s*no)/i.test(l));
  if (phoneLine) {
    const phoneMatch = phoneLine.match(/(?:\+?\d[\d\s()-]{7,}\d)/);
    if (phoneMatch) out.phone = phoneMatch[0].trim();
  }

  if (!out.registrant) {
    const regMatch = joined.match(/(?:registered\s*to|registrant|proprietor|owner|name\s*of\s*(?:the\s*)?(?:owner|business\s*owner))[^A-Za-z]{0,10}([A-Za-z][A-Za-z .,'-]{4,80})/i);
    if (regMatch) out.registrant = regMatch[1].trim();
  }

  // Address heuristic for business certs.
  if (!out.address) {
    const addressLine = lines.find((l) => /(barangay|city\s+of|province|region\s+[ivx]+)/i.test(l) && !stopName.test(l));
    if (addressLine) out.address = addressLine;
  }

  if (!out.address) {
    const addressInline = normalized.match(/\((barangay)\)\s+(.{5,140}?)\s+is\s+a\s+business\s+name\s+registered/i);
    if (addressInline?.[2]) out.address = cleanCandidate(addressInline[2]);
  }

  // Fallback legal name — longest text-heavy line in top block excluding boilerplate.
  const nameLine = lines.slice(0, 14)
    .filter((l) => l.replace(/[^A-Za-z]/g, "").length >= 4)
    .filter((l) => !stopName.test(l))
    .filter((l) => !/^(barangay|city\s+of|province|region\s+[ivx]+)/i.test(l))
    .filter((l) => !/(business\s*name\s*no\.?|registration\s*(?:no|number))/i.test(l))
    .sort((a, b) => b.length - a.length)[0];
  if (!out.legalName && nameLine) out.legalName = nameLine.slice(0, 120);

  return out;
}

export function ReceiptCard() {
  const BIZ_DOC_ACCEPT = "image/*,.pdf,.txt,.md,.csv,.json,.rtf,.doc,.docx,.odt,.xls,.xlsx";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<OwnerReceipt | null>(null);
  const [busy, setBusy] = useState(false);

  // Business profile (editable, OCR-assisted).
  const [biz, setBiz] = useState<BusinessProfile>(EMPTY_BIZ);
  const [bizDirty, setBizDirty] = useState<Record<keyof BusinessProfile, boolean>>({
    legalName: false,
    address: false,
    registrant: false,
    businessNumber: false,
    taxId: false,
    email: false,
    phone: false,
  });
  const [bizOpen, setBizOpen] = useState(false);
  const [bizSaving, setBizSaving] = useState(false);
  const [bizMsg, setBizMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    getBusinessProfile().then((p) => setBiz(p)).catch(() => {});
  }, []);

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
  const rangeLabel = from ? `${MONTHS[month]} ${from}${to && to !== from ? `–${to}` : ""}, ${year}` : "Pick a start and end day";

  const setField = (k: keyof BusinessProfile, v: string) => {
    setBiz((prev) => ({ ...prev, [k]: v }));
    setBizDirty((prev) => ({ ...prev, [k]: true }));
  };

  const saveBiz = async () => {
    setBizSaving(true);
    setBizMsg(null);
    const res = await saveBusinessProfile(biz);
    setBizSaving(false);
    setBizMsg(res.ok ? { text: "Business details saved — they'll appear on your receipts." } : { text: res.error, error: true });
  };

  const runOcr = async (file: File) => {
    setOcrBusy(true);
    setOcrText("");
    setBizMsg(null);
    try {
      const lowerName = file.name.toLowerCase();
      const isImage = file.type.startsWith("image/");
      let text = "";

      if (isImage) {
        const { recognize } = await import("tesseract.js");
        const { data } = await recognize(file, "eng");
        text = (data?.text ?? "").trim();
      } else if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const pdfjsAny = pdfjs as any;
        if (pdfjsAny.GlobalWorkerOptions && !pdfjsAny.GlobalWorkerOptions.workerSrc) {
          pdfjsAny.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@6.1.200/legacy/build/pdf.worker.min.mjs";
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        const chunks: string[] = [];
        for (let page = 1; page <= doc.numPages; page++) {
          const p = await doc.getPage(page);
          const content = await p.getTextContent();
          const pageText = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .trim();
          if (pageText) chunks.push(pageText);
        }
        text = chunks.join("\n").trim();
        if (!text) throw new Error("No text could be extracted from this PDF. If this is a scanned/image-only PDF, try uploading the image itself or a PDF with selectable text.");
      } else if (lowerName.endsWith(".docx") || lowerName.endsWith(".odt")) {
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        text = (result.value ?? "").trim();
      } else if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        const xlsx = await import("xlsx");
        const wb = xlsx.read(await file.arrayBuffer(), { type: "array" });
        text = wb.SheetNames
          .map((sheetName) => xlsx.utils.sheet_to_csv(wb.Sheets[sheetName] ?? {}))
          .join("\n")
          .trim();
      } else if (lowerName.endsWith(".doc")) {
        throw new Error("Legacy .doc files are not supported yet. Please upload DOCX, PDF, image, or text file.");
      } else {
        text = (await file.text()).trim();
      }

      if (!text) throw new Error("The uploaded file appears empty or unreadable.");

      setOcrText(text);
      const parsed = parseBusinessText(text);
      // Refresh OCR-filled values, but never clobber fields the owner typed manually.
      setBiz((prev) => ({
        legalName: bizDirty.legalName ? prev.legalName : (parsed.legalName || prev.legalName || ""),
        address: bizDirty.address ? prev.address : (parsed.address || prev.address || ""),
        registrant: bizDirty.registrant ? prev.registrant : (parsed.registrant || prev.registrant || ""),
        businessNumber: bizDirty.businessNumber ? prev.businessNumber : (parsed.businessNumber || prev.businessNumber || ""),
        taxId: bizDirty.taxId ? prev.taxId : (parsed.taxId || prev.taxId || ""),
        email: bizDirty.email ? prev.email : (parsed.email || prev.email || ""),
        phone: bizDirty.phone ? prev.phone : (parsed.phone || prev.phone || ""),
      }));
      setBizMsg({ text: "Scanned. Review the fields and edit anything that's off, then Save." });
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Couldn't read that document.";
      setBizMsg({ text: `${message} You can still type your details manually.`, error: true });
    } finally {
      setOcrBusy(false);
    }
  };

  const handlePickedFile = (file: File | null | undefined) => {
    if (!file || ocrBusy) return;
    void runOcr(file);
  };

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

    // Business header — only render fields the owner actually set.
    const bizLines: string[] = [];
    if (biz.address) bizLines.push(biz.address);
    if (biz.registrant) bizLines.push(`Registered to: ${biz.registrant}`);
    if (biz.businessNumber) bizLines.push(`Business No.: ${biz.businessNumber}`);
    if (biz.taxId) bizLines.push(`Tax ID: ${biz.taxId}`);
    const contact = [biz.email, biz.phone].filter(Boolean).join("  ·  ");
    if (contact) bizLines.push(contact);

    const headerHeight = Math.max(60, 34 + bizLines.length * 14);
    doc.setFillColor(246, 246, 248);
    doc.roundedRect(left, y, right - left, headerHeight, 8, 8, "F");
    y += 22;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(17, 24, 39);
    doc.text(biz.legalName || "Your Business", left + 12, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(70, 70, 70);
    for (const l of bizLines) { y += 14; doc.text(l, left + 12, y); }

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
    if (biz.businessNumber) doc.text(`Business No. ${biz.businessNumber}`, right, y, { align: "right" });
    y += 14;
    doc.text("This document is not valid for claim of input tax.", left, y);
    y += 14;
    doc.text("This receipt serves as an official receipt and may be used for lawful legal purposes.", left, y);

    doc.save(`innvil-receipt-${year}-${String(month + 1).padStart(2, "0")}-${String(from).padStart(2, "0")}_to_${String(to ?? from).padStart(2, "0")}.pdf`);
  };

  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border";
  const bizFilled = Object.values(biz).some((v) => v.trim());

  return (
    <Card title="Earnings receipt" icon={FileText}>
      <p className="fp-text-dim text-sm mb-4">Pick a start and end day, then generate a downloadable PDF receipt with each top-up (date/time + amount) and your total orders deduction.</p>

      {/* Business details — editable + OCR auto-fill */}
      <div className="fp-panel-raised border fp-line-soft rounded-xl mb-6">
        <button onClick={() => setBizOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Building2 size={15} className="fp-gold" /> Business details on your receipt
            {!bizFilled && <span className="text-[11px] fp-gold-soft-bg fp-gold px-2 py-0.5 rounded-full">Set this up</span>}
          </span>
          <ChevronDown size={16} className={`fp-text-faint transition-transform ${bizOpen ? "rotate-180" : ""}`} />
        </button>

        {bizOpen && (
          <div className="px-4 pb-4 space-y-3 border-t fp-line-soft pt-3">
            <div
              className={`flex flex-wrap items-center gap-2 border border-dashed fp-line-soft rounded-lg p-2 transition-colors ${dragOver ? "fp-gold-border fp-gold-soft-bg" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!ocrBusy) setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handlePickedFile(e.dataTransfer.files?.[0]);
              }}
            >
              <label className={`text-xs fp-gold border fp-line-soft rounded-lg px-3 py-2 cursor-pointer flex items-center gap-1.5 ${ocrBusy ? "opacity-60 pointer-events-none" : ""}`}>
                {ocrBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {ocrBusy ? "Scanning…" : "Upload registration document"}
                <input
                  type="file"
                  accept={BIZ_DOC_ACCEPT}
                  className="hidden"
                  disabled={ocrBusy}
                  onChange={(e) => { handlePickedFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
              <span className="fp-text-faint text-[11px]">Accepts images, PDF, DOCX/ODT, TXT/CSV/JSON, and XLS/XLSX. You can also drag and drop. The document isn&apos;t stored — only the details you save.</span>
            </div>

            {bizMsg && (
              <p className={`text-xs flex items-center gap-1.5 ${bizMsg.error ? "text-red-400" : "fp-safe"}`}>
                {bizMsg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {bizMsg.text}
              </p>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="fp-text-dim text-xs fp-mono uppercase">Legal / business name</label>
                <input value={biz.legalName} onChange={(e) => setField("legalName", e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. Acme Digital Services" />
              </div>
              <div className="sm:col-span-2">
                <label className="fp-text-dim text-xs fp-mono uppercase">Address</label>
                <input value={biz.address} onChange={(e) => setField("address", e.target.value)} className={`${inputCls} mt-1`} placeholder="Business address" />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Registrant / owner</label>
                <input value={biz.registrant} onChange={(e) => setField("registrant", e.target.value)} className={`${inputCls} mt-1`} placeholder="Registered owner name" />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Business / registration no.</label>
                <input value={biz.businessNumber} onChange={(e) => setField("businessNumber", e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. 8338762" />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Tax ID / TIN (optional)</label>
                <input value={biz.taxId} onChange={(e) => setField("taxId", e.target.value)} className={`${inputCls} mt-1`} placeholder="Tax identification no." />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Email (optional)</label>
                <input value={biz.email} onChange={(e) => setField("email", e.target.value)} className={`${inputCls} mt-1`} placeholder="billing@yourbusiness.com" />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Phone (optional)</label>
                <input value={biz.phone} onChange={(e) => setField("phone", e.target.value)} className={`${inputCls} mt-1`} placeholder="+1 555 000 0000" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={saveBiz} disabled={bizSaving} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-60">
                <Save size={14} /> {bizSaving ? "Saving…" : "Save business details"}
              </button>
            </div>

            {ocrText && (
              <details className="mt-1">
                <summary className="fp-text-faint text-xs cursor-pointer">View raw scanned text</summary>
                <pre className="fp-text-faint text-[11px] whitespace-pre-wrap mt-2 max-h-40 overflow-auto fp-panel border fp-line-soft rounded-lg p-2">{ocrText}</pre>
              </details>
            )}
          </div>
        )}
      </div>

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
