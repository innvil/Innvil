"use client";

import { useEffect, useState } from "react";
import { getCommunityPromotionChannelLink, setCommunityPromotionChannelLink } from "@/src/lib/actions/watch-dashboard";

/** Fallback promotion redirect for a community with no Telegram Forum
 *  topics at all (an ordinary group/supergroup has no "topic" the existing
 *  Promotion-topic policy can attach to) -- a plain link/@handle the owner
 *  enters once, stated verbatim in a solicitation warning whenever no real
 *  Forum-topic-based Promotion topic applies. Never validated against
 *  Telegram; purely informational text included in a warning message. */
export function PromotionChannelLinkControl({ communityId }: { communityId: string }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommunityPromotionChannelLink(communityId).then((v) => {
      if (!cancelled) setDraft(v ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await setCommunityPromotionChannelLink(communityId, draft || null);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft(res.data.link ?? "");
    setSaved(true);
  };

  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-white/80">Promotion channel/group link (fallback)</p>
      <p className="text-[11px] text-white/50 mt-0.5">
        Only used when this community has no Telegram Forum topics (an ordinary group has no "topics" to assign a Promotion policy to). If you have a
        separate dedicated promotions group/channel, enter its link or @handle here — it'll be mentioned in solicitation warnings instead. Leave blank if
        you don't have one.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setSaved(false);
            setDraft(e.target.value);
          }}
          placeholder="e.g. @BytehumorPromo or https://t.me/BytehumorPromo"
          className="flex-1 bg-black/30 text-xs text-white/80 rounded px-2 py-1.5 border border-white/10"
        />
        <button
          onClick={onSave}
          disabled={busy}
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
