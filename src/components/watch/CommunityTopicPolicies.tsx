"use client";

import { useEffect, useState } from "react";
import { getCommunityTopics, setCommunityTopicPolicy, setCommunityTopicName } from "@/src/lib/actions/watch-dashboard";

type TopicPolicy = "general" | "announcement" | "promotion" | "normal" | "custom";

interface TopicRow {
  messageThreadId: number;
  topicName: string | null;
  customName: string | null;
  policy: TopicPolicy;
}

const POLICY_LABELS: Record<TopicPolicy, string> = {
  general: "General",
  announcement: "Announcement",
  promotion: "Promotion (solicitation allowed here)",
  normal: "Normal (restricted)",
  custom: "Custom (restricted)",
};

/** True only when a real name is known for this topic -- mirrors
 *  hasKnownTopicName in community-topics.ts exactly (this is the client-side
 *  copy, since that module isn't safe to import into a "use client" file). */
function hasKnownName(t: TopicRow): boolean {
  return !!(t.customName?.trim() || t.topicName?.trim());
}

function displayLabel(t: TopicRow): string {
  return t.customName?.trim() || t.topicName?.trim() || `Topic ${t.messageThreadId}`;
}

/** Silence/command/fallback policy (§4/§5) -- lets the owner assign a
 *  policy to each auto-discovered Telegram Forum topic in this community,
 *  without ever needing to hunt for a raw numeric message_thread_id. The
 *  "Promotion" policy is the one that overrides the community-wide
 *  solicitation toggle for that specific topic. Topics are discovered
 *  automatically the first time a message is processed in them -- if none
 *  appear yet, either this chat isn't a Telegram Forum (topics aren't
 *  enabled) or no message has been sent in a topic since this feature
 *  shipped.
 *
 *  Each topic also gets an editable display-name override (2026-09-02, live
 *  feedback: "if you cannot give it a direct name, put some field where one
 *  can put promotion channel name"). Telegram only reports a topic's real
 *  name via a forum_topic_created/edited service message -- a topic created
 *  before the bot joined has no such name on record and never will unless
 *  the owner types one in here. A solicitation warning never states a real
 *  destination name unless one is actually known (see hasKnownTopicName in
 *  community-topics.ts); without this field, a nameless Promotion topic
 *  would silently fall back to a generic community-wide destination
 *  instead, which is why filling this in matters most for whichever topic
 *  is assigned the "Promotion" policy. */
export function CommunityTopicPolicies({ communityId }: { communityId: string }) {
  const [topics, setTopics] = useState<TopicRow[] | null>(null);
  const [busyThreadId, setBusyThreadId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    getCommunityTopics(communityId).then((rows) => {
      if (!cancelled) {
        setTopics(rows);
        setNameDrafts(Object.fromEntries(rows.map((t: TopicRow) => [t.messageThreadId, t.customName ?? ""])));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  if (topics === null) return null;

  const onChangePolicy = async (messageThreadId: number, policy: TopicPolicy) => {
    setBusyThreadId(messageThreadId);
    setError(null);
    const res = await setCommunityTopicPolicy(communityId, messageThreadId, policy);
    if (!res.ok) {
      setBusyThreadId(null);
      setError(res.error);
      return;
    }
    // A full reload, not just local state -- PromotionChannelLinkControl
    // (rendered as a sibling right below this one) only checks whether a
    // real "promotion"-policy topic already exists ONCE, on its own mount,
    // to decide whether to show its own "do you have a dedicated Promotion
    // channel?" fallback question at all. A local-only update here left
    // that sibling reading stale data, so assigning "Promotion" to a topic
    // didn't make its own redundant fallback question disappear until the
    // next full page load. Reloading keeps every dependent control in sync,
    // matching the same simplest-correct-refresh convention already used
    // elsewhere in this codebase for cross-component state dependencies.
    window.location.reload();
  };

  const onSaveName = async (messageThreadId: number) => {
    setBusyThreadId(messageThreadId);
    setError(null);
    const res = await setCommunityTopicName(communityId, messageThreadId, nameDrafts[messageThreadId] ?? null);
    if (!res.ok) {
      setBusyThreadId(null);
      setError(res.error);
      return;
    }
    window.location.reload();
  };

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-white/80">Topic policies</p>
      <p className="text-[11px] text-white/50 mt-0.5">
        {topics.length === 0
          ? "No Telegram Forum topics detected yet in this community — topics appear here automatically once a message is processed in one."
          : "Assign a policy to each detected topic. Promotion is the one place solicitation is always allowed, regardless of the community-wide toggle above."}
      </p>
      {topics.length > 0 && (
        <div className="mt-2 space-y-2">
          {topics.map((t) => {
            const draft = nameDrafts[t.messageThreadId] ?? "";
            const dirty = draft.trim() !== (t.customName ?? "").trim();
            return (
              <div key={t.messageThreadId} className="rounded-md bg-white/[0.03] px-2.5 py-1.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-white/80 truncate">{displayLabel(t)}</span>
                  <select
                    className="bg-black/30 text-xs text-white/80 rounded px-1.5 py-1 border border-white/10 disabled:opacity-50"
                    value={t.policy}
                    disabled={busyThreadId === t.messageThreadId}
                    onChange={(e) => onChangePolicy(t.messageThreadId, e.target.value as TopicPolicy)}
                  >
                    {(Object.keys(POLICY_LABELS) as TopicPolicy[]).map((p) => (
                      <option key={p} value={p}>
                        {POLICY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    className="flex-1 min-w-0 bg-black/30 text-[11px] text-white/70 rounded px-2 py-1 border border-white/10 disabled:opacity-50"
                    placeholder="Display name (e.g. Promotion) — used in warnings instead of the raw topic"
                    value={draft}
                    disabled={busyThreadId === t.messageThreadId}
                    onChange={(e) => setNameDrafts((d) => ({ ...d, [t.messageThreadId]: e.target.value }))}
                  />
                  {dirty && (
                    <button
                      type="button"
                      className="text-[11px] text-teal-300 hover:text-teal-200 whitespace-nowrap px-1.5 py-1 disabled:opacity-50"
                      disabled={busyThreadId === t.messageThreadId}
                      onClick={() => onSaveName(t.messageThreadId)}
                    >
                      Save
                    </button>
                  )}
                </div>
                {!hasKnownName(t) && t.policy === "promotion" && (
                  <p className="text-[10px] text-amber-300/80">
                    No name is known for this topic yet — Telegram never told us its name. Warnings will fall back to this community&apos;s general Promotion destination until you type one above.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
