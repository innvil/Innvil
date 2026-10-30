"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, MessageSquare, Send } from "lucide-react";
import { Card, Pill } from "@/src/components/ui";
import {
  getOwnerSupportThread,
  getPlatformSupportThread,
  listOwnerSupportMessages,
  listPlatformSupportMessages,
  ownerReplyToPlatformSupportThread,
  superAdminReplyToPlatformSupportThread,
  setPlatformSupportStatus,
  type PlatformSupportThread,
  type PlatformSupportThreadDetail,
} from "@/src/lib/actions/platform-support";

type Viewer = "owner" | "innvil";

function when(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The real Innvil support surface: persisted threads and in-app replies. */
export function PlatformSupportInbox({ viewer }: { viewer: Viewer }) {
  const [threads, setThreads] = useState<PlatformSupportThread[] | null>(null);
  const [opened, setOpened] = useState<PlatformSupportThreadDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const request = viewer === "owner" ? listOwnerSupportMessages() : listPlatformSupportMessages();
    request.then(setThreads).catch(() => setThreads([]));
  };
  useEffect(() => { load(); }, [viewer]);

  const open = async (threadId: string) => {
    setError(null);
    const detail = viewer === "owner" ? await getOwnerSupportThread(threadId) : await getPlatformSupportThread(threadId);
    if (!detail) { setError("Couldn't open that conversation."); return; }
    setOpened(detail);
    setThreads((previous) => previous?.map((thread) => thread.id === threadId ? { ...thread, unread: false } : thread) ?? previous);
  };

  const sendReply = async () => {
    if (!opened || busy) return;
    setBusy(true); setError(null);
    const result = viewer === "owner"
      ? await ownerReplyToPlatformSupportThread(opened.thread.id, reply)
      : await superAdminReplyToPlatformSupportThread(opened.thread.id, reply);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setReply("");
    await open(opened.thread.id);
    load();
  };

  const changeStatus = async (status: "open" | "resolved") => {
    if (!opened || viewer !== "innvil" || busy) return;
    setBusy(true); setError(null);
    const result = await setPlatformSupportStatus(opened.thread.id, status);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpened((current) => current ? { ...current, thread: { ...current.thread, status } } : current);
    setThreads((current) => current?.map((thread) => thread.id === opened.thread.id ? { ...thread, status } : thread) ?? current);
  };

  if (opened) {
    return (
    <Card title="Innvil conversation" icon={MessageSquare} right={<div className="flex items-center gap-2"><Pill tone={opened.thread.status === "resolved" ? "safe" : "muted"}>{opened.thread.status === "resolved" ? "Resolved" : "Open"}</Pill>{viewer === "innvil" && (opened.thread.status === "resolved" ? <button onClick={() => changeStatus("open")} disabled={busy} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-2.5 py-1 disabled:opacity-60">Reopen</button> : <button onClick={() => changeStatus("resolved")} disabled={busy} className="text-xs fp-safe-soft-bg fp-safe rounded-lg px-2.5 py-1 disabled:opacity-60">Mark resolved</button>)}</div>}>
        <button onClick={() => { setOpened(null); setError(null); }} className="fp-text-faint text-xs flex items-center gap-1 mb-4 hover:fp-text"><ArrowLeft size={13} /> All conversations</button>
        <p className="fp-display text-lg">{opened.thread.subject}</p>
        {viewer === "innvil" && opened.thread.ownerEmail && <p className="fp-text-faint text-xs fp-mono mt-1">{opened.thread.ownerEmail}</p>}
        <div className="space-y-3 mt-5">
          {opened.messages.map((message) => {
            const fromInnvil = message.direction === "outbound";
            const mine = viewer === "innvil" ? fromInnvil : !fromInnvil;
            return (
              <div key={message.id} className={`max-w-[90%] rounded-xl border px-3.5 py-3 ${mine ? "ml-auto fp-gold-soft-bg fp-gold-border" : "fp-panel-raised fp-line-soft"}`}>
                <p className="text-[11px] fp-text-faint mb-1">{fromInnvil ? "Innvil" : "Panel owner"} · {when(message.createdAt)}</p>
                <p className="text-sm leading-relaxed whitespace-pre-line fp-text">{message.body}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-5 border-t fp-line-soft pt-4">
          <label className="fp-text-dim text-xs fp-mono uppercase">Reply in Innvil</label>
          <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} maxLength={5000} placeholder="Write your reply…" className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border resize-y mt-1.5" />
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <button onClick={sendReply} disabled={busy || !reply.trim()} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 mt-3 disabled:opacity-60"><Send size={14} /> {busy ? "Sending…" : "Send reply"}</button>
          <p className="fp-text-faint text-xs mt-2">The message is delivered here. Email only alerts the other side that a reply is waiting.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title={viewer === "innvil" ? "Panel owner conversations" : "Your Innvil conversations"} icon={MessageSquare} right={<button onClick={load} className="text-xs fp-gold">Refresh</button>}>
      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
      {threads === null ? <p className="fp-text-faint text-sm py-4 text-center">Loading…</p> : threads.length === 0 ? <p className="fp-text-faint text-sm py-4 text-center">No conversations yet.</p> : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <button key={thread.id} onClick={() => open(thread.id)} className="w-full text-left fp-panel-raised border fp-line-soft rounded-xl px-4 py-3 hover:fp-gold-border">
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium truncate">{thread.subject}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {thread.unread && <span className="w-2 h-2 rounded-full fp-gold-bg" aria-label="Unread" />}
                  <Pill tone={thread.status === "resolved" ? "safe" : "muted"}>{thread.status === "resolved" ? "Resolved" : "Open"}</Pill>
                </span>
              </span>
              <span className="block fp-text-faint text-xs mt-1 truncate">{viewer === "innvil" ? (thread.ownerEmail ?? "panel owner") : (thread.lastDirection === "outbound" ? "Innvil replied" : "You replied")} · {when(thread.lastMessageAt)}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
