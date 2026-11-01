"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bot, X, Send } from "lucide-react";
import { ownerAssistantReply, globalAssistantReply } from "@/src/lib/actions/ai-assistant";
import { AI_STREAMING, streamAiReply } from "@/src/lib/ai/chat-stream";

/* Floating owner AI assistant — available anywhere in the panel admin. Free
   (Innvil-funded). Streams from /api/ai/assistant. Self-hides if the AI key isn't
   configured on the server. */

type Msg = { role: "user" | "assistant"; content: string };

export function OwnerAssistantChat({ panelId }: { panelId?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: `Hi! I'm your Innvil assistant. Ask me how to connect a provider, import and price services, go live, take payments, understand your commission — anything about running your panels on Innvil.` }]);
    }
  }, [open, messages.length]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      if (AI_STREAMING) {
        setMessages((m) => [...m, { role: "assistant", content: "" }]);
        const put = (content: string) => setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: "assistant", content }; return c; });
        try {
          await streamAiReply("/api/ai/assistant", panelId ? { panelId, messages: next } : { messages: next }, put);
        } catch (e) {
          put(e instanceof Error ? e.message : "Something went wrong reaching the assistant. Please try again.");
        }
      } else {
        const res = panelId ? await ownerAssistantReply(panelId, next) : await globalAssistantReply(next);
        setMessages((m) => [...m, { role: "assistant", content: res.ok ? res.reply : res.error }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Something went wrong reaching the assistant. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close assistant" : "Open AI assistant"}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full fp-gold-bg text-[#0A0B0F] flex items-center justify-center shadow-2xl hover:brightness-105 transition"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-40 w-[calc(100vw-2.5rem)] sm:w-96 h-[32rem] max-h-[75vh] fp-panel border fp-line rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b fp-line-soft flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg fp-gold-soft-bg fp-gold flex items-center justify-center"><Bot size={15} /></span>
              <div>
                <p className="text-sm font-medium leading-tight">AI Assistant</p>
                <p className="fp-text-faint text-[11px] leading-tight">Innvil · here to help you run your panels</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="fp-text-faint hover:fp-text"><X size={16} /></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "fp-gold-bg text-[#0A0B0F]" : "fp-panel-raised border fp-line-soft fp-text-dim"}`}>
                  {m.content || (busy ? "…" : "")}
                </div>
              </div>
            ))}
            {busy && messages[messages.length - 1]?.role === "user" && (
              <div className="flex justify-start"><div className="fp-panel-raised border fp-line-soft rounded-2xl px-3.5 py-2.5 text-sm fp-text-faint">Thinking…</div></div>
            )}
          </div>

          <div className="p-3 border-t fp-line-soft shrink-0 flex items-end gap-2">
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
    </>
  );
}
