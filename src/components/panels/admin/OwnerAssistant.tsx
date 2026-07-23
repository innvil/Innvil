"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bot, Send, CheckCircle2, AlertTriangle, Wallet, Lock, MessageCircle } from "lucide-react";
import { ownerAssistantReply, getSupportAddon, setSupportAddon, type SupportAddonInfo } from "@/src/lib/actions/ai-assistant";

/* AI Assistant tab (owner side). Two things:
   1. The owner's FREE Innvil assistant (chat) — helps run this panel.
   2. The paid Customer AI Support add-on ($2.99/mo from the panel's Innvil balance)
      — turns on the AI support chat for this panel's STOREFRONT customers. */

type Msg = { role: "user" | "assistant"; content: string };

export function OwnerAssistantTab({ panelId, panelName }: { panelId: string; panelName: string }) {
  const [addon, setAddon] = useState<SupportAddonInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [addonErr, setAddonErr] = useState<string | null>(null);

  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: `Hi! I'm your Innvil assistant for ${panelName}. Ask me anything about running this panel — connecting a provider, importing and pricing services, going live, payments, commission, and more.` },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = () => getSupportAddon(panelId).then((a) => { setAddon(a); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [panelId]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

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

  const toggleAddon = async (enable: boolean) => {
    setActionBusy(true); setAddonErr(null);
    const res = await setSupportAddon(panelId, enable);
    setActionBusy(false);
    if (!res.ok) { setAddonErr(res.error); return; }
    setAddon(res.data);
  };

  if (loading) return <p className="fp-text-faint text-sm py-8 text-center">Loading…</p>;
  const configured = addon?.configured ?? false;
  const price = addon?.price ?? 2.99;
  const canAfford = (addon?.innvilBalance ?? 0) >= price;

  return (
    <div className="max-w-2xl space-y-6">
      {/* ---- Free owner assistant ---- */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-8 h-8 rounded-lg fp-gold-soft-bg fp-gold flex items-center justify-center"><Bot size={16} /></span>
          <div>
            <p className="text-sm font-medium">Your AI assistant <span className="text-[10px] fp-safe-soft-bg fp-safe px-1.5 py-0.5 rounded-full align-middle">Free</span></p>
            <p className="fp-text-faint text-[11px]">Ask how to run this panel — grounded in its live stats. It can&apos;t change settings, it guides you.</p>
          </div>
        </div>

        {!configured ? (
          <p className="fp-text-faint text-xs flex items-center gap-1.5 py-4"><Lock size={12} /> The assistant is being set up on Innvil&apos;s side — check back shortly.</p>
        ) : (
          <div className="fp-panel border fp-line rounded-2xl flex flex-col h-[26rem] overflow-hidden">
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
        )}
      </div>

      {/* ---- Paid customer support add-on ---- */}
      <div className="fp-panel border fp-gold-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-10 h-10 rounded-xl fp-gold-soft-bg fp-gold flex items-center justify-center"><MessageCircle size={18} /></span>
          <div className="min-w-0">
            <p className="fp-display text-base">Customer AI Support <span className="text-[10px] fp-gold-soft-bg fp-gold px-1.5 py-0.5 rounded-full align-middle">Add-on</span></p>
            <p className="fp-text-faint text-[11px]">An AI support chat on your storefront that answers YOUR customers.</p>
          </div>
        </div>

        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          Give your customers instant answers about your services, their orders, deposits and how ordering works —
          grounded in your catalog and each customer&apos;s own account. It escalates to a ticket when it can&apos;t help,
          cutting your support load.
        </p>

        {addon?.enabled ? (
          <div className="flex items-center justify-between flex-wrap gap-2 fp-panel-raised border fp-line-soft rounded-xl p-3">
            <p className="text-xs fp-safe flex items-center gap-1.5"><CheckCircle2 size={13} /> Active on your storefront · renews {fmtDate(addon.nextChargeAt)} · ${price.toFixed(2)}/mo</p>
            <button onClick={() => toggleAddon(false)} disabled={actionBusy} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60 hover:fp-text">
              {actionBusy ? "…" : "Turn off"}
            </button>
          </div>
        ) : (
          <>
            <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 mb-3">
              <div className="flex items-baseline gap-1.5">
                <span className="fp-display text-2xl fp-gold">${price.toFixed(2)}</span>
                <span className="fp-text-dim text-sm">/ month</span>
              </div>
              <p className="fp-text-faint text-xs mt-1.5 leading-relaxed">
                Optional — <span className="fp-text">your panel stays 0% rent</span>. Billed from this panel&apos;s Innvil
                balance; cancel anytime. Covers the AI usage for your customers.
              </p>
            </div>
            {addon?.lapsed && (
              <p className="text-xs fp-gold flex items-center gap-1.5 mb-2"><AlertTriangle size={12} /> Paused because the Innvil balance ran low — top up and re-enable to resume.</p>
            )}
            <div className="flex items-center gap-2 text-xs fp-text-faint mb-3">
              <Wallet size={13} /> This panel&apos;s Innvil balance: <span className="fp-mono fp-text">${(addon?.innvilBalance ?? 0).toFixed(2)}</span>
            </div>
            {!configured ? (
              <p className="text-xs fp-text-faint flex items-center gap-1.5"><Lock size={12} /> Being set up on Innvil&apos;s side — check back shortly.</p>
            ) : (
              <>
                <button onClick={() => toggleAddon(true)} disabled={actionBusy || !canAfford} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60">
                  {actionBusy ? "Enabling…" : `Enable — $${price.toFixed(2)}/mo`}
                </button>
                {!canAfford && <p className="fp-text-faint text-xs mt-2">Add at least ${price.toFixed(2)} to this panel&apos;s Innvil balance (Billing → Add funds), then enable.</p>}
              </>
            )}
          </>
        )}
        {addonErr && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {addonErr}</p>}
      </div>
    </div>
  );
}
