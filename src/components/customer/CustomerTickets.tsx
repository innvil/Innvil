"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, ArrowLeft, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  createTicket, listCustomerTickets, getCustomerTicket, customerReply, customerCloseTicket,
  type TicketVM, type TicketThread,
} from "@/src/lib/actions/tickets";

const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border";

const STATUS_STYLE: Record<string, string> = {
  open: "fp-panel-raised fp-text-dim",
  answered: "fp-safe-soft-bg fp-safe",
  closed: "fp-panel-raised fp-text-faint",
};

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const mins = Math.max(1, Math.round((Date.now() - d) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function CustomerTickets({ panelId }: { panelId: string }) {
  const [tickets, setTickets] = useState<TicketVM[] | null>(null);
  const [view, setView] = useState<"list" | "new" | "thread">("list");
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // compose
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");

  const load = useCallback(async () => {
    setTickets(await listCustomerTickets(panelId));
  }, [panelId]);

  useEffect(() => { load(); }, [load]);

  const openThread = async (id: string) => {
    setErr(null);
    const t = await getCustomerTicket(id);
    if (!t) { setErr("Couldn't open that ticket."); return; }
    setThread(t);
    setView("thread");
  };

  const submitNew = async () => {
    setBusy(true); setErr(null);
    const res = await createTicket(panelId, subject, message);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setSubject(""); setMessage("");
    await load();
    await openThread(res.data.id);
  };

  const submitReply = async () => {
    if (!thread || !reply.trim()) return;
    setBusy(true); setErr(null);
    const res = await customerReply(thread.ticket.id, reply);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setReply("");
    await openThread(thread.ticket.id);
    load();
  };

  const closeTicket = async () => {
    if (!thread) return;
    setBusy(true);
    await customerCloseTicket(thread.ticket.id);
    setBusy(false);
    await openThread(thread.ticket.id);
    load();
  };

  /* ---- New ticket ---- */
  if (view === "new") {
    return (
      <div className="fp-panel border fp-line rounded-2xl p-5 max-w-xl">
        <button onClick={() => { setView("list"); setErr(null); }} className="fp-text-faint text-xs flex items-center gap-1 mb-4"><ArrowLeft size={13} /> Back</button>
        <p className="fp-display text-lg mb-4">New support ticket</p>
        <label className="fp-text-dim text-xs fp-mono uppercase">Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Order #abc not delivered" className={`${inputCls} mt-1.5 mb-3`} />
        <label className="fp-text-dim text-xs fp-mono uppercase">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Describe your issue…" className={`${inputCls} mt-1.5`} />
        {err && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
        <button onClick={submitNew} disabled={busy} className="fp-btn-primary text-sm font-semibold px-4 py-2.5 rounded-lg mt-4 disabled:opacity-60">
          {busy ? "Sending…" : "Send ticket"}
        </button>
      </div>
    );
  }

  /* ---- Thread ---- */
  if (view === "thread" && thread) {
    const closed = thread.ticket.status === "closed";
    return (
      <div className="fp-panel border fp-line rounded-2xl p-5 max-w-xl">
        <div className="flex items-center justify-between mb-4 gap-3">
          <button onClick={() => { setView("list"); setThread(null); }} className="fp-text-faint text-xs flex items-center gap-1"><ArrowLeft size={13} /> All tickets</button>
          <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_STYLE[thread.ticket.status]}`}>{thread.ticket.status}</span>
        </div>
        <p className="fp-display text-lg mb-4">{thread.ticket.subject}</p>
        <div className="space-y-3 mb-4 max-h-[46vh] overflow-y-auto pr-1">
          {thread.messages.map((m) => (
            <div key={m.id} className={`rounded-xl p-3 text-sm ${m.senderRole === "customer" ? "fp-panel-raised border fp-line-soft ml-6" : "fp-gold-soft-bg mr-6"}`}>
              <p className="fp-text-faint text-[11px] fp-mono mb-1">{m.senderRole === "customer" ? "You" : "Support"} · {timeAgo(m.createdAt)}</p>
              <p className="whitespace-pre-line leading-relaxed">{m.body}</p>
            </div>
          ))}
        </div>
        {err && <p className="text-xs text-red-400 mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
        {closed ? (
          <p className="fp-text-faint text-xs flex items-center gap-1.5"><CheckCircle2 size={12} /> This ticket is closed. Reply to reopen it.</p>
        ) : null}
        <div className="flex gap-2 mt-2">
          <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitReply()} placeholder="Write a reply…" className={inputCls} />
          <button onClick={submitReply} disabled={busy || !reply.trim()} className="fp-btn-primary text-sm font-semibold px-3 rounded-lg disabled:opacity-50 flex items-center gap-1"><Send size={14} /></button>
        </div>
        {!closed && (
          <button onClick={closeTicket} disabled={busy} className="fp-text-faint text-xs mt-3 hover:fp-text">Close ticket</button>
        )}
      </div>
    );
  }

  /* ---- List ---- */
  return (
    <div className="fp-panel border fp-line rounded-2xl p-5 max-w-xl">
      <div className="flex items-center justify-between mb-4">
        <p className="fp-display text-lg">Support tickets</p>
        <button onClick={() => { setView("new"); setErr(null); }} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1">
          <Plus size={13} /> New ticket
        </button>
      </div>
      {tickets === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : tickets.length === 0 ? (
        <div className="text-center py-8">
          <p className="fp-text-dim text-sm mb-3">No tickets yet.</p>
          <button onClick={() => setView("new")} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">Contact support</button>
        </div>
      ) : (
        tickets.map((t) => (
          <button key={t.id} onClick={() => openThread(t.id)} className="w-full text-left flex items-center justify-between border-b fp-line-soft last:border-0 py-3.5 text-sm gap-3 hover:fp-gold">
            <div className="min-w-0 flex items-center gap-2">
              {t.unread && <span className="w-2 h-2 rounded-full fp-gold-bg shrink-0" />}
              <div className="min-w-0">
                <p className="truncate">{t.subject}</p>
                <p className="text-xs fp-text-faint fp-mono mt-0.5">{timeAgo(t.lastMessageAt)}{t.lastSender === "owner" ? " · support replied" : ""}</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[t.status]}`}>{t.status}</span>
          </button>
        ))
      )}
    </div>
  );
}
