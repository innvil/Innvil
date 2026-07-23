"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, PenLine, Eye, EyeOff, Trash2, RefreshCw, Plus, ExternalLink } from "lucide-react";
import { Pill } from "@/src/components/ui";
import { ArticleBody } from "@/src/components/blog/ArticleBody";
import {
  listAdminPosts, listTopics, addTopic, deleteTopic, generateDraftNow,
  publishPost, unpublishPost, deletePost, updatePostMeta,
  type AdminBlogPost, type AdminBlogTopic,
} from "@/src/lib/actions/blog-admin";

/* AI blog review: draft → review/edit → publish. Shared by the /superadmin route
   (Blog tab) and the owner-app "Blog" sidebar section (super-admin accounts). All
   actions are super_admin-gated server-side. */

const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-1.5 outline-none focus:fp-gold-border";

type EditState = { id: string; title: string; description: string; slug: string; tag: string; keywords: string };

export function BlogReview() {
  const [posts, setPosts] = useState<AdminBlogPost[] | null>(null);
  const [topics, setTopics] = useState<AdminBlogTopic[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [genTopic, setGenTopic] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [newKeywords, setNewKeywords] = useState("");

  const load = () =>
    Promise.all([listAdminPosts(), listTopics()])
      .then(([p, t]) => { setPosts(p); setTopics(t); })
      .catch((e) => { setPosts([]); setTopics([]); setMsg({ text: e instanceof Error ? e.message : "Load failed.", error: true }); });
  useEffect(() => { load(); }, []);

  const fmtDate = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const generate = async () => {
    setBusy("gen"); setMsg(null);
    const res = await generateDraftNow(genTopic.trim() || undefined);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setGenTopic("");
    setMsg({ text: `Draft written: “${res.data.title}”. Review it below before publishing.` });
    load();
  };

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) => {
    setBusy(key); setMsg(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error ?? "Action failed.", error: true }); return; }
    if (okText) setMsg({ text: okText });
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(`edit:${editing.id}`); setMsg(null);
    const res = await updatePostMeta(editing.id, {
      title: editing.title,
      description: editing.description,
      slug: editing.slug,
      tag: editing.tag,
      keywords: editing.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    });
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setEditing(null);
    setMsg({ text: "Saved." });
    load();
  };

  const addTopicSubmit = async () => {
    if (!newTopic.trim()) return;
    setBusy("addtopic"); setMsg(null);
    const res = await addTopic(newTopic.trim(), newKeywords.split(",").map((k) => k.trim()).filter(Boolean));
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setNewTopic(""); setNewKeywords("");
    load();
  };

  const drafts = (posts ?? []).filter((p) => p.status === "draft");
  const published = (posts ?? []).filter((p) => p.status === "published");
  const pendingTopics = (topics ?? []).filter((t) => t.status === "pending");

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim">
        <span className="fp-text">AI writes drafts; you approve.</span> A daily cron generates one draft from your
        topic queue (or a fallback topic). <span className="fp-text">Nothing goes live until you publish it here</span> —
        this keeps the site safe from search-engine penalties for unreviewed AI content.
      </div>

      {msg && (
        <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
          {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
        </p>
      )}

      {/* Generate now */}
      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <p className="text-sm font-medium flex items-center gap-2"><PenLine size={15} className="fp-gold" /> Generate a draft now</p>
        <p className="fp-text-faint text-xs">Leave the topic blank to use the next queued (or fallback) topic, or type a specific one.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={genTopic}
            onChange={(e) => setGenTopic(e.target.value)}
            placeholder="Optional topic, e.g. How to reduce refunds on an SMM panel"
            className={inputCls}
          />
          <button onClick={generate} disabled={busy === "gen"} className="fp-btn-primary text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-60 whitespace-nowrap shrink-0">
            {busy === "gen" ? "Writing…" : "Generate draft"}
          </button>
        </div>
        <p className="fp-text-faint text-[11px]">Requires <span className="fp-mono">ANTHROPIC_API_KEY</span> on the server.</p>
      </div>

      {/* Drafts awaiting review */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Drafts to review {drafts.length > 0 && <span className="fp-gold">· {drafts.length}</span>}</p>
        {posts === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>
        ) : drafts.length === 0 ? (
          <p className="fp-text-faint text-sm py-4">No drafts waiting. Generate one above or wait for the daily run.</p>
        ) : (
          drafts.map((p) => {
            const isEditing = editing?.id === p.id;
            const isPreview = previewId === p.id;
            return (
              <div key={p.id} className="fp-panel border fp-line rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.title}</p>
                    <p className="fp-text-faint text-xs fp-mono mt-0.5">
                      /blog/{p.slug} · {p.source === "ai" ? "AI" : "manual"}{p.topic ? ` · ${p.topic}` : ""} · {fmtDate(p.createdAt)}
                    </p>
                  </div>
                  <Pill tone="muted">Draft</Pill>
                </div>
                <p className="fp-text-dim text-sm mt-2 leading-relaxed">{p.description}</p>

                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <button onClick={() => { setPreviewId(isPreview ? null : p.id); }} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                    {isPreview ? <><EyeOff size={12} /> Hide</> : <><Eye size={12} /> Preview</>}
                  </button>
                  <button
                    onClick={() => setEditing(isEditing ? null : { id: p.id, title: p.title, description: p.description, slug: p.slug, tag: p.tag, keywords: p.keywords.join(", ") })}
                    className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <PenLine size={12} /> {isEditing ? "Cancel edit" : "Edit"}
                  </button>
                  <button onClick={() => act(`pub:${p.id}`, () => publishPost(p.id), "Published — it's now live on /blog.")} disabled={busy === `pub:${p.id}`} className="text-xs fp-safe-soft-bg fp-safe rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-60">
                    <CheckCircle2 size={12} /> Publish
                  </button>
                  <button onClick={() => act(`del:${p.id}`, () => deletePost(p.id))} disabled={busy === `del:${p.id}`} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-60">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>

                {isEditing && (
                  <div className="mt-4 space-y-2 border-t fp-line-soft pt-4">
                    <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Title" className={inputCls} />
                    <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Meta description" rows={2} className={inputCls} />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="url-slug" className={`${inputCls} fp-mono`} />
                      <input value={editing.tag} onChange={(e) => setEditing({ ...editing, tag: e.target.value })} placeholder="Tag" className={inputCls} />
                    </div>
                    <input value={editing.keywords} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} placeholder="keyword one, keyword two" className={inputCls} />
                    <button onClick={saveEdit} disabled={busy === `edit:${p.id}`} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                      {busy === `edit:${p.id}` ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                )}

                {isPreview && (
                  <div className="mt-4 border-t fp-line-soft pt-5">
                    <h3 className="fp-display text-xl mb-4">{p.title}</h3>
                    <ArticleBody intro={p.intro} sections={p.sections} />
                    {p.cta && (
                      <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 mt-2">
                        <p className="text-sm font-medium mb-1">{p.cta.heading}</p>
                        <p className="fp-text-dim text-sm">{p.cta.text}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Published */}
      {published.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Published · {published.length}</p>
          {published.map((p) => (
            <div key={p.id} className="fp-panel border fp-line rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.title}</p>
                <a href={`/blog/${p.slug}`} target="_blank" rel="noreferrer" className="fp-text-faint text-xs fp-mono flex items-center gap-1 hover:fp-gold">
                  /blog/{p.slug} <ExternalLink size={11} />
                </a>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => act(`unpub:${p.id}`, () => unpublishPost(p.id), "Unpublished — back to draft.")} disabled={busy === `unpub:${p.id}`} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60">Unpublish</button>
                <button onClick={() => act(`del:${p.id}`, () => deletePost(p.id))} disabled={busy === `del:${p.id}`} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1.5 disabled:opacity-60"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Topic queue */}
      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Topic queue {pendingTopics.length > 0 && <span className="fp-gold">· {pendingTopics.length} pending</span>}</p>
          <button onClick={load} className="text-xs fp-gold flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
        </div>
        <p className="fp-text-faint text-xs">The writer takes the highest-priority pending topic first. Empty queue → it uses a built-in fallback topic.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Topic, e.g. SMM panel vs doing it manually" className={inputCls} />
          <input value={newKeywords} onChange={(e) => setNewKeywords(e.target.value)} placeholder="keywords (comma-sep)" className={inputCls} />
          <button onClick={addTopicSubmit} disabled={busy === "addtopic" || !newTopic.trim()} className="fp-btn-primary text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-60 whitespace-nowrap shrink-0 flex items-center gap-1.5">
            <Plus size={14} /> Add
          </button>
        </div>
        {topics === null ? (
          <p className="fp-text-faint text-sm py-2 text-center">Loading…</p>
        ) : (topics.length === 0 ? (
          <p className="fp-text-faint text-xs">No topics yet — add some so the AI writes what you want.</p>
        ) : (
          <div className="space-y-1.5">
            {topics.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs truncate">{t.topic}</p>
                  {t.keywords.length > 0 && <p className="fp-text-faint text-[11px] fp-mono truncate">{t.keywords.join(", ")}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Pill tone={t.status === "pending" ? "gold" : "muted"}>{t.status}</Pill>
                  <button onClick={() => act(`dt:${t.id}`, () => deleteTopic(t.id))} disabled={busy === `dt:${t.id}`} className="text-red-400 disabled:opacity-60"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
