"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Rocket, AlertTriangle, CheckCircle2, Loader2, Sliders, Zap, ClipboardList, Wand2, Wallet, LifeBuoy, Upload, Eye, Trash2, Rss } from "lucide-react";
import { formatMoney } from "@/src/lib/money";
import { analyzeCampaign } from "@/src/lib/automation/links";
import { extractLinksFromFile } from "@/src/lib/automation/file-links";
import { runCampaign, listCampaigns, type CampaignVM, type RunCampaignResult } from "@/src/lib/actions/campaigns";
import { getAutomatorSub, subscribeAutomator, type AutomatorSubInfo } from "@/src/lib/actions/automator-sub";
import { getWatchedAccounts, addWatchedAccount, setWatchedActive, removeWatchedAccount, type WatchedAccountVM } from "@/src/lib/actions/watched";
import { AutomationConfig } from "./AutomationConfig";

/* Storefront Campaign Automation surface — always visible (steady). States:
   1. not offered (owner has no tier) → premium teaser + "contact support to enable"
   2. offered but not subscribed → the pitch + Subscribe ($6.99/mo)
   3. subscribed → the full paste-links config + run surface. */

const STEPS = [
  { icon: ClipboardList, t: "Paste your links", d: "Drop in as many post links as you want — one paste, any platform." },
  { icon: Wand2, t: "We detect each platform", d: "Every link is matched to the right platform automatically." },
  { icon: Zap, t: "Your services fire", d: "Your configured services order on all of them at once — no one-by-one." },
];

function HowItWorks() {
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {STEPS.map((s, i) => (
        <div key={s.t} className="fp-panel-raised border fp-line-soft rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-8 h-8 rounded-lg fp-violet-soft-bg fp-violet grid place-items-center"><s.icon size={16} /></span>
            <span className="fp-text-faint text-[11px] fp-mono">0{i + 1}</span>
          </div>
          <p className="text-sm font-medium">{s.t}</p>
          <p className="fp-text-dim text-xs mt-1 leading-relaxed">{s.d}</p>
        </div>
      ))}
    </div>
  );
}

/** Watched accounts (Business+) — register feeds that auto-order new posts. */
function WatchedAccountsCard({ panelId }: { panelId?: string }) {
  const [accounts, setAccounts] = useState<WatchedAccountVM[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!panelId) return;
    getWatchedAccounts(panelId).then((i) => { if (i) setAccounts(i.accounts); setLoaded(true); }).catch(() => setLoaded(true));
  }, [panelId]);

  const add = async () => {
    if (!panelId || busy) return;
    if (!feedUrl.trim()) { setMsg({ text: "Paste a feed URL.", error: true }); return; }
    setBusy(true); setMsg(null);
    const res = await addWatchedAccount(panelId, feedUrl, label);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setAccounts((prev) => [res.data, ...prev]);
    setFeedUrl(""); setLabel("");
    setMsg({ text: "Watching — new posts will auto-order." });
  };

  const toggle = async (a: WatchedAccountVM) => {
    if (!panelId) return;
    setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)));
    await setWatchedActive(panelId, a.id, !a.active);
  };

  const remove = async (a: WatchedAccountVM) => {
    if (!panelId) return;
    setAccounts((prev) => prev.filter((x) => x.id !== a.id));
    await removeWatchedAccount(panelId, a.id);
  };

  return (
    <div className="fp-panel border fp-line rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm font-medium flex items-center gap-1.5"><Eye size={15} className="fp-violet" /> Watched accounts <span className="text-[10px] fp-violet-soft-bg fp-violet px-1.5 py-0.5 rounded-full">Business+</span></p>
        <p className="fp-text-faint text-[11px] mt-0.5">Auto-order new posts. Paste an account&apos;s <span className="fp-mono">RSS/Atom feed</span> — YouTube channels have one built in; for X / Instagram / TikTok use an RSS bridge (e.g. RSS.app). We check every few minutes and fire your configured services on each new post.</p>
      </div>

      <div className="grid sm:grid-cols-[1fr_auto] gap-2">
        <div className="space-y-2">
          <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://…/feed.xml"
            className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional) — e.g. @myhandle"
            className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border" />
        </div>
        <button onClick={add} disabled={busy || !feedUrl.trim()} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 flex items-center gap-2 self-start">
          {busy ? <><Loader2 size={14} className="animate-spin" /> Adding…</> : <><Rss size={14} /> Watch</>}
        </button>
      </div>
      {msg && <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>}

      {loaded && accounts.length > 0 && (
        <div className="space-y-1.5">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="fp-text truncate">{a.label || a.feedUrl}</p>
                <p className="fp-text-faint truncate">{a.lastCheckedAt ? `Checked ${new Date(a.lastCheckedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "Not checked yet"}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggle(a)} className={`px-2 py-1 rounded-md border ${a.active ? "fp-safe-soft-bg fp-safe border-[rgba(126,200,140,0.3)]" : "fp-text-faint fp-line-soft"}`}>{a.active ? "Active" : "Paused"}</button>
                <button onClick={() => remove(a)} className="text-red-400 border border-red-500/30 rounded-md p-1"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="fp-text-faint text-[11px]">Requires a configured profile (Configure above) and wallet balance. Only posts on your plan&apos;s platforms are ordered.</p>
    </div>
  );
}

export function CampaignSurface({ panelId, currency = "USD", onContactSupport }: { panelId?: string; currency?: string; onContactSupport?: () => void }) {
  const [sub, setSub] = useState<AutomatorSubInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [subBusy, setSubBusy] = useState(false);
  const [subErr, setSubErr] = useState<string | null>(null);

  const [links, setLinks] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunCampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<CampaignVM[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileMsg, setFileMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const analysis = useMemo(() => analyzeCampaign(links), [links]);
  const fmt = (n: number) => formatMoney(n, currency);

  const loadSub = () => {
    if (!panelId) { setLoading(false); return; }
    getAutomatorSub(panelId).then((s) => { setSub(s); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(loadSub, [panelId]);
  useEffect(() => { if (panelId && sub?.active) listCampaigns(panelId).then(setRecent).catch(() => {}); }, [panelId, sub?.active]);

  const subscribe = async () => {
    if (!panelId) return;
    setSubBusy(true); setSubErr(null);
    const res = await subscribeAutomator(panelId);
    setSubBusy(false);
    if (!res.ok) { setSubErr(res.error); return; }
    setSub(res.data);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileMsg({ text: "Reading…" });
    try {
      const found = await extractLinksFromFile(file);
      if (!found.length) { setFileMsg({ text: "No links found in that file.", error: true }); return; }
      setLinks((prev) => (prev.trim() ? prev.trim() + "\n" : "") + found.join("\n"));
      setFileMsg({ text: `Added ${found.length} link${found.length === 1 ? "" : "s"} from ${file.name}.` });
    } catch {
      setFileMsg({ text: "Couldn't read that file. Use csv, xlsx, docx or txt.", error: true });
    }
  };

  const run = async () => {
    if (!panelId || analysis.total === 0) return;
    setBusy(true); setError(null); setResult(null);
    const res = await runCampaign({ panelId, links });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setResult(res.data);
    setLinks("");
    listCampaigns(panelId).then(setRecent).catch(() => {});
  };

  const Header = (
    <div>
      <h2 className="text-xl font-semibold flex items-center gap-2"><Rocket size={18} className="fp-violet" /> Campaign Automation</h2>
      <p className="fp-text-dim text-sm mt-1">Stop ordering one link at a time. Paste them all and let the automator do the rest.</p>
    </div>
  );

  if (loading) {
    return <div className="max-w-3xl py-16 text-center fp-text-faint flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>;
  }

  // ---- State 1: not offered → teaser + contact support ----
  if (!sub || !sub.offered) {
    return (
      <div className="max-w-3xl space-y-5">
        {Header}
        <HowItWorks />
        <div className="fp-panel border fp-violet-border rounded-2xl p-5 text-center">
          <p className="text-sm font-medium mb-1">Want this on your account?</p>
          <p className="fp-text-dim text-sm mb-4">Campaign Automation saves you hours of manual ordering. Ask us to turn it on.</p>
          {onContactSupport && (
            <button onClick={onContactSupport} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-2">
              <LifeBuoy size={15} /> Contact support to enable it
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- State 2: offered but not subscribed → subscribe ----
  if (!sub.active) {
    return (
      <div className="max-w-3xl space-y-5">
        {Header}
        <HowItWorks />
        <div className="fp-panel border fp-violet-border rounded-2xl p-5">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {sub.promoActive && <span className="fp-text-faint text-lg line-through">{fmt(sub.basePrice)}</span>}
            <span className="fp-display text-3xl fp-violet">{fmt(sub.price)}</span>
            <span className="fp-text-dim text-sm">/ month</span>
            {sub.promoActive && <span className="text-[10px] fp-safe-soft-bg fp-safe px-2 py-0.5 rounded-full ml-1">{sub.promoLabel || "Promo"}</span>}
          </div>
          <p className="fp-text-faint text-xs mt-1.5 mb-2">Unlimited campaigns, keyword-smart routing, your services on every link. Cancel anytime.</p>
          {(sub.fileUpload || sub.watchedAccounts) && (
            <ul className="text-xs fp-text-dim space-y-1 mb-4">
              {sub.fileUpload && <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="fp-safe" /> File upload (csv / xlsx / docx)</li>}
              {sub.watchedAccounts && <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="fp-safe" /> Watched accounts · full-auto</li>}
            </ul>
          )}
          {sub.lapsed && <p className="text-xs fp-gold flex items-center gap-1.5 mb-2"><AlertTriangle size={12} /> Your subscription paused for low balance — top up and re-subscribe.</p>}
          <div className="flex items-center gap-2 text-xs fp-text-faint mb-3"><Wallet size={13} /> Wallet balance: <span className="fp-mono fp-text">{fmt(sub.balance)}</span></div>
          <button onClick={subscribe} disabled={subBusy || !sub.canAfford} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60 flex items-center gap-2">
            {subBusy ? <><Loader2 size={15} className="animate-spin" /> Subscribing…</> : <>Subscribe — {fmt(sub.price)}/mo</>}
          </button>
          {!sub.canAfford && <p className="fp-text-faint text-xs mt-2">Add at least {fmt(sub.price)} to your wallet, then subscribe.</p>}
          {subErr && <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5"><AlertTriangle size={12} /> {subErr}</p>}
        </div>
      </div>
    );
  }

  // ---- State 3: subscribed → full surface ----
  return (
    <div className="max-w-3xl space-y-5">
      {Header}

      <div className="fp-panel border fp-line rounded-2xl p-4">
        <textarea
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          rows={7}
          placeholder={"Paste post links — one per line, or separated by commas/spaces.\nhttps://instagram.com/p/…\nhttps://tiktok.com/@user/video/…"}
          className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border resize-y"
        />

        {analysis.total > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <span className="fp-text-dim">{analysis.total} link{analysis.total === 1 ? "" : "s"} ·</span>
            {Object.entries(analysis.byPlatform).map(([p, n]) => (
              <span key={p} className="fp-panel-raised border fp-line-soft rounded-full px-2.5 py-1 capitalize">{p} · {n}</span>
            ))}
            {analysis.unknown > 0 && (
              <span className="text-amber-400/90 flex items-center gap-1"><AlertTriangle size={12} /> {analysis.unknown} unrecognized</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setConfiguring((v) => !v)} className={`text-xs px-3 py-2 rounded-lg border flex items-center gap-1.5 ${configuring ? "fp-violet-soft-bg fp-violet fp-violet-border" : "fp-panel-raised fp-line-soft fp-text-dim hover:fp-text"}`}>
              <Sliders size={13} /> Configure
            </button>
            {sub?.fileUpload && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.docx,.txt" onChange={onFile} className="hidden" />
                <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-2 rounded-lg border fp-panel-raised fp-line-soft fp-text-dim hover:fp-text flex items-center gap-1.5">
                  <Upload size={13} /> Upload file
                </button>
              </>
            )}
          </div>
          <button onClick={run} disabled={busy || analysis.total === 0} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50 flex items-center gap-2">
            {busy ? <><Loader2 size={15} className="animate-spin" /> Running…</> : <>Run campaign ({analysis.total})</>}
          </button>
        </div>
        {fileMsg && <p className={`text-xs mt-3 flex items-center gap-1.5 ${fileMsg.error ? "text-red-400" : "fp-safe"}`}>{fileMsg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {fileMsg.text}</p>}
        {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      </div>

      {configuring && panelId && <AutomationConfig panelId={panelId} onClose={() => setConfiguring(false)} />}

      {result && (
        <div className="fp-panel border fp-line rounded-2xl p-4">
          <p className="text-sm font-medium flex items-center gap-1.5 mb-3">
            <CheckCircle2 size={15} className="fp-safe" /> {result.ordersPlaced} order{result.ordersPlaced === 1 ? "" : "s"} placed · {fmt(result.totalCharge)}
            {result.skipped > 0 && <span className="fp-text-faint"> · {result.skipped} skipped</span>}
            {result.failed > 0 && <span className="text-red-400"> · {result.failed} failed</span>}
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {result.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
                <span className="truncate fp-text-dim">{it.link}</span>
                <span className="shrink-0 flex items-center gap-2">
                  <span className="capitalize fp-text-faint">{it.platform ?? "unknown"}</span>
                  <span className={it.status === "ordered" ? "fp-safe" : it.status === "failed" ? "text-red-400" : "fp-text-faint"}>
                    {it.status === "ordered" ? `${it.orders} order${it.orders === 1 ? "" : "s"}` : it.error || it.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <p className="fp-text-faint text-xs fp-mono uppercase mb-2">Recent campaigns</p>
          <div className="space-y-1.5">
            {recent.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 text-xs fp-panel border fp-line rounded-lg px-3 py-2.5">
                <span className="fp-text-dim">{new Date(c.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {c.totalLinks} links</span>
                <span className="flex items-center gap-2">
                  <span className="fp-mono">{fmt(c.totalCharge)}</span>
                  <span className={c.status === "completed" ? "fp-safe" : c.status === "failed" ? "text-red-400" : "fp-text-faint"}>{c.status}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub?.watchedAccounts && <WatchedAccountsCard panelId={panelId} />}
    </div>
  );
}
