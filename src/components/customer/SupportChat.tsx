"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, LifeBuoy, CheckCircle2 } from "lucide-react";
import { customerSupportReply, escalateSupportToTicket } from "@/src/lib/actions/ai-support";

/* Floating AI support widget for the customer dashboard. Only mounted when the
   panel has the AI add-on enabled. Talks to the grounded, privacy-guarded support
   action; "Talk to a human" opens a real support ticket. */

type Msg = { role: "user" | "assistant"; content: string };

export function SupportChat({ panelId, brandName }: { panelId: string; brandName: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: `Hi! I'm ${brandName}'s support assistant. Ask me about our services, your orders, deposits, or how anything works. If I can't help, you can open a ticket with a human.` }]);
    }
  }, [open, brandName, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setNotice(null);
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await customerSupportReply(panelId, next);
      setMessages((m) => [...m, { role: "assistant", content: res.ok ? res.reply : res.error }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  const talkToHuman = async () => {
    if (escalating) return;
    setEscalating(true);
    setNotice(null);
    const res = await escalateSupportToTicket(panelId, messages);
    setEscalating(false);
    if (res.ok) {
      setNotice("Ticket opened — check the Tickets tab for a human reply.");
      setMessages((m) => [...m, { role: "assistant", content: "I've opened a support ticket for you. The team will reply in your Tickets tab." }]);
    } else {
      setNotice(res.error);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support" : "Open support"}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full fp-gold-bg text-[#0A0B0F] flex items-center justify-center shadow-2xl hover:brightness-105 transition"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-40 w-[calc(100vw-2.5rem)] sm:w-96 h-[32rem] max-h-[75vh] fp-panel border fp-line rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b fp-line-soft flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg fp-gold-soft-bg fp-gold flex items-center justify-center"><LifeBuoy size={15} /></span>
              <div>
                <p className="text-sm font-medium leading-tight">Support</p>
                <p className="fp-text-faint text-[11px] leading-tight">{brandName} · AI assistant</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="fp-text-faint hover:fp-text"><X size={16} /></button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "fp-gold-bg text-[#0A0B0F]" : "fp-panel-raised border fp-line-soft fp-text-dim"}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="fp-panel-raised border fp-line-soft rounded-2xl px-3.5 py-2.5 text-sm fp-text-faint">Typing…</div>
              </div>
            )}
          </div>

          {/* Escalation + notice */}
          <div className="px-3 pt-2 shrink-0">
            {notice && <p className="text-[11px] fp-safe flex items-center gap-1 mb-2 px-1"><CheckCircle2 size={11} /> {notice}</p>}
            <button
              onClick={talkToHuman}
              disabled={escalating || messages.length < 2}
              className="w-full text-[11px] fp-text-dim border fp-line-soft rounded-lg py-1.5 flex items-center justify-center gap-1.5 disabled:opacity-50 hover:fp-text mb-2"
            >
              <LifeBuoy size={12} /> {escalating ? "Opening ticket…" : "Talk to a human"}
            </button>
          </div>

          {/* Composer */}
          <div className="p-3 border-t fp-line-soft shrink-0 flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask a question…"
              className="flex-1 resize-none fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border max-h-24"
            />
            <button onClick={send} disabled={busy || !input.trim()} className="w-9 h-9 rounded-lg fp-gold-bg text-[#0A0B0F] flex items-center justify-center disabled:opacity-50 shrink-0">
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
