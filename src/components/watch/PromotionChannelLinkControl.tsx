"use client";

import { useEffect, useState } from "react";
import { getCommunityPromotionChannel, setCommunityPromotionChannel, getCommunityTopics } from "@/src/lib/actions/watch-dashboard";

/** Fallback promotion redirect for a community with no Telegram Forum
 *  topics at all (an ordinary group/supergroup has no "topic" the existing
 *  Promotion-topic policy can attach to). Corrected 2026-09-02, per explicit
 *  live feedback: (1) reframed as a yes/no question rather than a bare link
 *  field -- "do you have a dedicated Promotion channel?" -- with the NAME as
 *  the primary, required-to-actually-use field (a warning speaks the name,
 *  never a raw link); (2) the system now auto-detects when this fallback
 *  isn't even needed -- if a real Telegram Forum "Promotion" topic is
 *  already assigned (via Topic Policies, above), that's the real redirect
 *  destination already, and this whole control collapses to a plain
 *  informational note instead of asking the owner to configure a second,
 *  redundant one. */
export function PromotionChannelLinkControl({ communityId }: { communityId: string }) {
  const [loading, setLoading] = useState(true);
  const [existingTopicName, setExistingTopicName] = useState<string | null>(null);
  const [hasChannel, setHasChannel] = useState(false);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCommunityTopics(communityId), getCommunityPromotionChannel(communityId)]).then(([topics, fallback]) => {
      if (cancelled) return;
      const promoTopic = topics.find((t) => t.policy === "promotion");
      setExistingTopicName(promoTopic ? promoTopic.topicName?.trim() || "this topic" : null);
      setName(fallback?.name ?? "");
      setLink(fallback?.link ?? "");
      setHasChannel(!!fallback?.name);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await setCommunityPromotionChannel(communityId, hasChannel ? name || null : null, hasChannel ? link || null : null);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName(res.data.name ?? "");
    setLink(res.data.link ?? "");
    setSaved(true);
  };

  if (loading) return null;

  if (existingTopicName) {
    return (
      <div className="mt-4">
        <p className="text-xs font-medium text-white/80">Promotion channel</p>
        <p className="text-[11px] text-white/50 mt-0.5">
          A Telegram Forum topic is already configured as your Promotion destination: <span className="text-teal-300">{existingTopicName}</span> (set
          under Topic Policies, above). Solicitation warnings already redirect there — no separate fallback is needed.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-white/80">Do you have a dedicated Promotion channel or group?</p>
      <p className="text-[11px] text-white/50 mt-0.5">
        Only relevant when this community has no Telegram Forum topics (an ordinary group has no "topics" to assign a Promotion policy to, so it can't be
        auto-detected the way the Topic Policies one is). If you have a separate group/channel for promotions, we'll mention it BY NAME in solicitation
        warnings.
      </p>
      <div className="mt-2 flex items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={!hasChannel} onChange={() => { setHasChannel(false); setSaved(false); }} />
          <span className="text-white/70">No</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={hasChannel} onChange={() => { setHasChannel(true); setSaved(false); }} />
          <span className="text-white/70">Yes</span>
        </label>
      </div>
      {hasChannel && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setSaved(false);
              setName(e.target.value);
            }}
            placeholder="Channel name, e.g. Bytehumor Promo"
            className="w-full bg-black/30 text-xs text-white/80 rounded px-2 py-1.5 border border-white/10"
          />
          <input
            type="text"
            value={link}
            onChange={(e) => {
              setSaved(false);
              setLink(e.target.value);
            }}
            placeholder="Optional link, e.g. https://t.me/BytehumorPromo"
            className="w-full bg-black/30 text-xs text-white/80 rounded px-2 py-1.5 border border-white/10"
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={busy || (hasChannel && !name.trim())}
          className="text-xs px-2.5 py-1.5 rounded-md bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 disabled:opacity-50 shrink-0"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-[11px] text-teal-300 shrink-0">Saved</span>}
      </div>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
