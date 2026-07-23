"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bot, Send, CheckCircle2, AlertTriangle, Wallet, Lock } from "lucide-react";
import { getPanelAssistant, setPanelAssistant, ownerAssistantReply, type AssistantSubInfo } from "@/src/lib/actions/ai-assistant";

/* Owner AI Assistant tab — a paid ($2.99/mo, from the panel's Innvil balance)
   helper that answers how-to questions about running THIS panel. The panel itself
   stays 0% rent; this is opt-in. */

type Msg = { role: "user" | "assistant"; content: string };

export function OwnerAssistantTab({ panelId, panelName }: { panelId: string; panelName: string }) {
  const [info, setInfo] = useState<AssistantSubInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = () =>
    getPanelAssistant(panelId).then((i) => { setInfo(i); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [panelId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

  const toggle = async (enable: boolean) => {
    setActionBusy(true); setErr(null);
    const res = await setPanelAssistant(panelId, enable);
    setActionBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setInfo(res.data);
    if (enable) setMessages([{ role: "assistant", content: `Hi! I'm your Innvil assistant for ${panelName}. Ask me anything about running this panel — connecting a provider, importing and pricing services, going live, payments, commission, and more.` }]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next); setInput(""); setBusy(true);
    const res = await ownerAssistantReply(panelId, next);
    setBusy(false);
    setMessages((m) => [...m, { role: "assistant", content: res.ok ? res.reply : res.error }]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  if (loading) return <p className="fp-text-faint text-sm py-8 text-center">Loading…</p>;
  if (!info) return <p className="fp-text-faint text-sm py-8 text-center">Couldn&apos;t load the assistant.</p>;

  // ---- Not subscribed: the offer card ----
  if (!info.enabled) {
    const canAfford = info.innvilBalance >= info.price;
    return (
      <div className="max-w-2xl space-y-4">
        <div className="fp-panel border fp-gold-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-11 h-11 rounded-xl fp-gold-soft-bg fp-gold flex items-center justify-center"><Bot size={20} /></span>
            <div>
              <p className="fp-display text-lg">AI Assistant</p>
              <p className="fp-text-faint text-xs">Your personal Innvil expert for this panel</p>
            </div>
          </div>
          <p className="fp-text-dim text-sm leading-relaxed mb-4">
            A private assistant that knows how Innvil works <span className="fp-text">and</span> this panel&apos;s live
            numbers — ask it how to connect a provider, import and price services, go live, take payments, understand
            your commission, or why something isn&apos;t working. Answers in seconds, any time.
          </p>

          <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 mb-4">
            <div className="flex items-baseline gap-1.5">
              <span className="fp-display text-2xl fp-gold">${info.price.toFixed(2)}</span>
              <span className="fp-text-dim text-sm">/ month</span>
            </div>
            <p className="fp-text-faint text-xs mt-1.5 leading-relaxed">
              Optional add-on — <span className="fp-text">your panel itself stays 0% rent</span>. Billed from this panel&apos;s
              Innvil balance; cancel anytime. Covers the assistant&apos;s AI usage.
            </p>
          </div>

          {info.lapsed && (
            <p className="text-xs fp-gold flex items-center gap-1.5 mb-3"><AlertTriangle size={12} /> Your subscription paused because the Innvil balance ran low. Top up and re-enable to resume.</p>
          )}

          <div className="flex items-center gap-2 text-xs fp-text-faint mb-4">
            <Wallet size={13} /> This panel&apos;s Innvil balance: <span className="fp-mono fp-text">${info.innvilBalance.toFixed(2)}</span>
          </div>

          {!info.configured ? (
            <p className="text-xs fp-text-faint flex items-center gap-1.5"><Lock size={12} /> The AI Assistant is being set up on Innvil&apos;s side — check back shortly.</p>
          ) : (
            <>
              <button
                onClick={() => toggle(true)}
                disabled={actionBusy || !canAfford}
                className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60"
              >
                {actionBusy ? "Enabling…" : `Enable — $${info.price.toFixed(2)}/mo`}
              </button>
              {!canAfford && (
                <p className="fp-text-faint text-xs mt-2">Add at least ${info.price.toFixed(2)} to this panel&apos;s Innvil balance (Billing → Add funds), then enable.</p>
              )}
            </>
          )}
          {err && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
        </div>
      </div>
    );
  }

  // ---- Subscribed: chat + manage ----
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg fp-gold-soft-bg fp-gold flex items-center justify-center"><Bot size={16} /></span>
          <div>
            <p className="text-sm font-medium">AI Assistant</p>
            <p className="fp-text-faint text-[11px]">Active · renews {fmtDate(info.nextChargeAt)} · ${info.price.toFixed(2)}/mo</p>
          </div>
        </div>
        <button onClick={() => toggle(false)} disabled={actionBusy} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60 hover:fp-text">
          {actionBusy ? "…" : "Cancel add-on"}
        </button>
      </div>
      {err && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}

      <div className="fp-panel border fp-line rounded-2xl flex flex-col h-[30rem] overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "fp-gold-bg text-[#0A0B0F]" : "fp-panel-raised border fp-line-soft fp-text-dim"}`}>
                {m.content}
              </div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="fp-panel-raised border fp-line-soft rounded-2xl px-3.5 py-2.5 text-sm fp-text-faint">Thinking…</div></div>}
        </div>
        <div className="p-3 border-t fp-line-soft flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask about running this panel…"
            className="flex-1 resize-none fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border max-h-24"
          />
          <button onClick={send} disabled={busy || !input.trim()} className="w-9 h-9 rounded-lg fp-gold-bg text-[#0A0B0F] flex items-center justify-center disabled:opacity-50 shrink-0">
            <Send size={16} />
          </button>
        </div>
      </div>
      <p className="fp-text-faint text-[11px] flex items-center gap-1"><CheckCircle2 size={11} className="fp-safe" /> Grounded in this panel&apos;s live stats. It can&apos;t change settings — it guides you to the right place.</p>
    </div>
  );
}
