"use client";

import React, { useEffect, useState } from "react";
import { Megaphone, Plus, CheckCircle2, XCircle, Clock, Send, AlertTriangle, Users } from "lucide-react";
import { Card } from "@/src/components/ui";
import {
  listCampaigns, createCampaign, updateCampaignMessage, approveCampaign, scheduleCampaign, cancelCampaign,
  getKnownChatsSummary, type BotManagerCampaignRow, type CampaignType, type TargetAudience, type KnownChatSummary,
} from "@/src/lib/actions/bot-manager-campaigns";
import { chatTypesForAudience } from "@/src/lib/moderator/bot-manager-campaign-audience";

const CAMPAIGN_TYPE_OPTIONS: Array<{ value: CampaignType; label: string }> = [
  { value: "marketing_broadcast", label: "Marketing broadcast" },
  { value: "product_announcement", label: "Product announcement" },
  { value: "release_update", label: "Release update" },
  { value: "service_notice", label: "Service notice" },
  { value: "educational_tip", label: "Educational tip" },
];

const AUDIENCE_OPTIONS: Array<{ value: TargetAudience; label: string }> = [
  { value: "all", label: "All known chats" },
  { value: "private_users", label: "Private users" },
  { value: "groups", label: "Groups & supergroups" },
  { value: "channels", label: "Channels" },
];

function statusBadge(status: BotManagerCampaignRow["status"]) {
  const map: Record<string, string> = {
    draft: "fp-panel border fp-line-soft fp-text-dim",
    scheduled: "bg-blue-500/10 text-blue-400 border border-blue-500/30",
    sending: "fp-gold-soft-bg fp-gold border border-transparent",
    sent: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
    cancelled: "bg-red-500/10 text-red-400 border border-red-500/30",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide font-semibold ${map[status] ?? ""}`}>{status}</span>;
}

/** Real eligible-chat estimate for a chosen audience -- computed from the
 *  SAME chatTypesForAudience mapping the cron sweep itself uses, applied to
 *  the real known-chats breakdown -- never a guess, never a duplicated
 *  category list. */
function eligibleCountFor(summary: KnownChatSummary | null, audience: TargetAudience): number {
  if (!summary) return 0;
  const types = chatTypesForAudience(audience);
  if (!types) return summary.marketingEnabled;
  return types.reduce((sum, t) => sum + (summary.byType[t] ?? 0), 0);
}

/** Superadmin-only control for innvil_bot_manager's proactive marketing
 *  campaigns (Phase 4.Q, second half). Nothing here sends a Telegram
 *  message directly -- every action only ever writes campaign STATE
 *  (create/edit/approve/schedule/cancel); the real send only ever happens
 *  from the cron sweep (sweepBotManagerCampaigns), on its own next tick,
 *  reading whatever state this UI last saved. Approval is the hard gate:
 *  an unapproved campaign can be scheduled but the sweep will never claim
 *  it. */
export function BotManagerCampaignsAdmin() {
  const [campaigns, setCampaigns] = useState<BotManagerCampaignRow[] | null>(null);
  const [summary, setSummary] = useState<KnownChatSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newType, setNewType] = useState<CampaignType>("marketing_broadcast");
  const [newAudience, setNewAudience] = useState<TargetAudience>("all");
  const [newMessage, setNewMessage] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const refresh = async () => {
    setListError(null);
    const [c, s] = await Promise.all([listCampaigns(), getKnownChatsSummary()]);
    if (!c.ok) { setListError(c.error); setLoading(false); return; }
    setCampaigns(c.data);
    if (s.ok) setSummary(s.data);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    setCreateError(null);
    if (!newMessage.trim()) { setCreateError("Message is required."); return; }
    setCreateBusy(true);
    const res = await createCampaign({ campaignType: newType, targetAudience: newAudience, message: newMessage.trim() });
    setCreateBusy(false);
    if (!res.ok) { setCreateError(res.error); return; }
    setNewMessage("");
    setShowCreate(false);
    await refresh();
  };

  const startEdit = (c: BotManagerCampaignRow) => { setEditingId(c.id); setEditMessage(c.message); setRowError(null); };

  const saveEdit = async (id: string) => {
    setRowBusy(id);
    setRowError(null);
    const res = await updateCampaignMessage(id, editMessage);
    setRowBusy(null);
    if (!res.ok) { setRowError(res.error); return; }
    setEditingId(null);
    await refresh();
  };

  const toggleApprove = async (c: BotManagerCampaignRow) => {
    setRowBusy(c.id);
    setRowError(null);
    const res = await approveCampaign(c.id, !c.approved);
    setRowBusy(null);
    if (!res.ok) { setRowError(res.error); return; }
    await refresh();
  };

  const doSchedule = async (c: BotManagerCampaignRow) => {
    setRowBusy(c.id);
    setRowError(null);
    const res = await scheduleCampaign(c.id, null);
    setRowBusy(null);
    if (!res.ok) { setRowError(res.error); return; }
    await refresh();
  };

  const doCancel = async (c: BotManagerCampaignRow) => {
    setRowBusy(c.id);
    setRowError(null);
    const res = await cancelCampaign(c.id);
    setRowBusy(null);
    if (!res.ok) { setRowError(res.error); return; }
    await refresh();
  };

  return (
    <Card title="Bot manager campaigns" icon={Megaphone}>
      <p className="fp-text-dim text-sm mb-4">
        innvil_bot_manager&apos;s proactive marketing sends — approved-campaign-only. Nothing sends until a
        campaign is both <span className="fp-text font-semibold">approved</span> and{" "}
        <span className="fp-text font-semibold">scheduled</span>; only the cron sweep ever actually sends, in
        bounded batches, using innvil_bot_manager&apos;s own credential — never the reactive-support bot&apos;s.
      </p>

      {summary && (
        <div className="flex items-center gap-2 flex-wrap mb-4 text-xs fp-text-dim">
          <Users size={13} />
          <span>{summary.marketingEnabled} of {summary.total} known chats opted into marketing</span>
          {Object.entries(summary.byType).map(([t, n]) => (
            <span key={t} className="fp-panel border fp-line-soft rounded-full px-2 py-0.5">{t}: {n}</span>
          ))}
        </div>
      )}

      {!showCreate && (
        <button onClick={() => setShowCreate(true)} className="fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5 mb-4">
          <Plus size={14} /> New campaign
        </button>
      )}

      {showCreate && (
        <div className="fp-panel-raised border fp-line-soft rounded-lg p-4 space-y-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <select value={newType} onChange={(e) => setNewType(e.target.value as CampaignType)} className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none">
              {CAMPAIGN_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={newAudience} onChange={(e) => setNewAudience(e.target.value as TargetAudience)} className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none">
              {AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-xs fp-text-faint">{eligibleCountFor(summary, newAudience)} eligible chat(s) right now</span>
          </div>
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Campaign message..."
            rows={4}
            className="w-full fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none resize-none"
          />
          {createError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {createError}</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => void create()} disabled={createBusy} className="fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">Save draft</button>
            <button onClick={() => { setShowCreate(false); setCreateError(null); }} className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text">Cancel</button>
          </div>
        </div>
      )}

      {loading && <p className="text-sm fp-text-dim">Loading campaigns…</p>}
      {listError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {listError}</p>}

      {!loading && campaigns && campaigns.length === 0 && (
        <p className="text-sm fp-text-faint">No campaigns yet.</p>
      )}

      <div className="space-y-3">
        {(campaigns ?? []).map((c) => (
          <div key={c.id} className="fp-panel-raised border fp-line-soft rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {statusBadge(c.status)}
                <span className="text-xs fp-text-dim">{CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === c.campaignType)?.label ?? c.campaignType}</span>
                <span className="text-xs fp-text-faint">→ {AUDIENCE_OPTIONS.find((o) => o.value === c.targetAudience)?.label ?? c.targetAudience}</span>
                {c.approved
                  ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1"><CheckCircle2 size={10} /> approved</span>
                  : <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1"><Clock size={10} /> not approved</span>}
              </div>
              <span className="text-[11px] fp-text-faint">{c.sendCount} sent{c.errorCount > 0 ? `, ${c.errorCount} failed` : ""}</span>
            </div>

            {editingId === c.id ? (
              <div className="space-y-2">
                <textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} rows={4} className="w-full fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none resize-none" />
                <div className="flex items-center gap-2">
                  <button onClick={() => void saveEdit(c.id)} disabled={rowBusy === c.id} className="fp-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Save</button>
                  <button onClick={() => setEditingId(null)} className="fp-panel border fp-line-soft rounded-lg px-3 py-1.5 text-xs fp-text-dim hover:fp-text">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-sm fp-text whitespace-pre-wrap">{c.message}</p>
            )}

            {rowError && rowBusy === null && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {rowError}</p>}

            <div className="flex items-center gap-2 flex-wrap pt-1">
              {(c.status === "draft" || c.status === "scheduled") && editingId !== c.id && (
                <button onClick={() => startEdit(c)} className="fp-panel border fp-line-soft rounded-lg px-3 py-1.5 text-xs fp-text-dim hover:fp-text">Edit</button>
              )}
              {(c.status === "draft" || c.status === "scheduled") && (
                <button onClick={() => void toggleApprove(c)} disabled={rowBusy === c.id} className="fp-panel border fp-line-soft rounded-lg px-3 py-1.5 text-xs fp-text-dim hover:fp-text disabled:opacity-50">
                  {c.approved ? "Revoke approval" : "Approve"}
                </button>
              )}
              {c.status === "draft" && (
                <button onClick={() => void doSchedule(c)} disabled={rowBusy === c.id} className="fp-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1 disabled:opacity-50">
                  <Send size={12} /> Schedule
                </button>
              )}
              {(c.status === "draft" || c.status === "scheduled" || c.status === "sending") && (
                <button onClick={() => void doCancel(c)} disabled={rowBusy === c.id} className="fp-panel border fp-line-soft rounded-lg px-3 py-1.5 text-xs text-red-400 hover:text-red-300 flex items-center gap-1 disabled:opacity-50">
                  <XCircle size={12} /> Cancel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
