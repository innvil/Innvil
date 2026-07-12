"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MessageSquare, ArrowLeft, Send, AlertTriangle } from "lucide-react";
import { Card } from "@/src/components/ui";
import {
  listPanelTickets, getOwnerTicket, ownerReplyToTicket, setTicketStatus,
  type OwnerTicketVM, type OwnerTicketThread,
} from "@/src/lib/actions/admin-tickets";
import type { TicketStatus } from "@/src/lib/actions/tickets";

const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border";
const STATUS_STYLE: Record<string, string> = {
  open: "fp-gold-soft-bg fp-gold",
  answered: "fp-safe-soft-bg fp-safe",
  closed: "fp-panel-raised fp-text-faint",
};
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function SupportInbox({ panelId }: { panelId: string }) {
  const realPanel = isUuid(panelId);
  const [tickets, setTickets] = useState<OwnerTicketVM[] | null>(realPanel ? null : []);
  const [thread, setThread] = useState<OwnerTicketThread | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!realPanel) return;
    setTickets(await listPanelTickets(panelId));
  }, [panelId, realPanel]);

  useEffect(() => { load(); }, [load]);

  const open = async (id: string) => {
    setErr(null);
    const t = await getOwnerTicket(id);
    if (!t) { setErr("Couldn't open that ticket."); return; }
    setThread(t);
  };

  const submitReply = async () => {
    if (!thread || !reply.trim()) return;
    setBusy(true); setErr(null);
    const res = await ownerReplyToTicket(thread.ticket.id, reply);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setReply("");
    await open(thread.ticket.id);
    load();
  };

  const changeStatus = async (status: TicketStatus) => {
    if (!thread) return;
    setBusy(true);
    await setTicketStatus(thread.ticket.id, status);
    setBusy(false);
    await open(thread.ticket.id);
    load();
  };

  if (!realPanel) {
    return (
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-6 text-center fp-text-dim text-sm">
        Save this panel to receive customer support tickets here.
      </div>
    );
  }

  if (thread) {
    const closed = thread.ticket.status === "closed";
    return (
      <Card title="Support ticket" icon={MessageSquare} right={<span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_STYLE[thread.ticket.status]}`}>{thread.ticket.status}</span>}>
        <button onClick={() => setThread(null)} className="fp-text-faint text-xs flex items-center gap-1 mb-4"><ArrowLeft size={13} /> All tickets</button>
        <p className="fp-display text-lg">{thread.ticket.subject}</p>
        <p className="fp-text-faint text-xs fp-mono mb-4">{thread.ticket.customerEmail ?? "customer"}</p>
        <div className="space-y-3 mb-4 max-h-[46vh] overflow-y-auto pr-1">
          {thread.messages.map((m) => (
            <div key={m.id} className={`rounded-xl p-3 text-sm ${m.senderRole === "owner" ? "fp-gold-soft-bg ml-6" : "fp-panel-raised border fp-line-soft mr-6"}`}>
              <p className="fp-text-faint text-[11px] fp-mono mb-1">{m.senderRole === "owner" ? "You" : "Customer"} · {timeAgo(m.createdAt)}</p>
              <p className="whitespace-pre-line leading-relaxed">{m.body}</p>
            </div>
          ))}
        </div>
        {err && <p className="text-xs text-red-400 mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
        <div className="flex gap-2">
          <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitReply()} placeholder="Write a reply…" className={inputCls} />
          <button onClick={submitReply} disabled={busy || !reply.trim()} className="fp-btn-primary text-sm font-semibold px-3 rounded-lg disabled:opacity-50 flex items-center gap-1"><Send size={14} /></button>
        </div>
        <div className="mt-3">
          {closed
            ? <button onClick={() => changeStatus("open")} disabled={busy} className="fp-text-faint text-xs hover:fp-text">Reopen ticket</button>
            : <button onClick={() => changeStatus("closed")} disabled={busy} className="fp-text-faint text-xs hover:fp-text">Close ticket</button>}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Support inbox" icon={MessageSquare}>
      {err && <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
      {tickets === null ? (
        <p className="fp-text-faint text-sm py-6 text-center">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="fp-text-faint text-sm py-6 text-center">No tickets yet. Customer messages will appear here.</p>
      ) : (
        tickets.map((t) => (
          <button key={t.id} onClick={() => open(t.id)} className="w-full text-left flex items-center justify-between border-b fp-line-soft last:border-0 py-3.5 text-sm gap-3 hover:fp-gold">
            <div className="min-w-0 flex items-center gap-2">
              {t.unread && <span className="w-2 h-2 rounded-full fp-gold-bg shrink-0" />}
              <div className="min-w-0">
                <p className="truncate">{t.subject}</p>
                <p className="text-xs fp-text-faint fp-mono mt-0.5">{t.customerEmail ?? "customer"} · {timeAgo(t.lastMessageAt)}</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[t.status]}`}>{t.status}</span>
          </button>
        ))
      )}
    </Card>
  );
}
