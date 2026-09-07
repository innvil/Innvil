"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Megaphone, Plus, RefreshCw } from "lucide-react";
import {
  createPRFact,
  createPRFactsBulk,
  generatePRDraftFromQueue,
  createPressReleaseDraftsBulk,
  createPressReleaseDraft,
  deletePRFact,
  generatePRNow,
  getPressReleaseDetails,
  getPRGeneratorSettings,
  listPressReleases,
  listPRFactLibrary,
  markPublishedExternally,
  setPRFactActive,
  setPRGeneratorSettings,
  setPressReleaseStatus,
  type PRFactLibraryItem,
  type PRDetails,
  type PRGeneratorSettings,
  type PRItem,
  type PRStatus,
} from "@/src/lib/actions/pr-admin";

type ComplianceChecks = NonNullable<PRDetails["latestCompliance"]>["checks"];

const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-1.5 outline-none focus:fp-gold-border";

const statusLabel: Record<PRStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  published_externally: "Published externally",
  rejected: "Rejected",
};

const statusTone: Record<PRStatus, string> = {
  draft: "fp-gold-soft-bg fp-gold",
  reviewed: "fp-panel-raised fp-text-dim border fp-line-soft",
  approved: "fp-safe-soft-bg fp-safe",
  published_externally: "fp-safe-soft-bg fp-safe",
  rejected: "text-red-400 border border-red-500/30",
};

export function PRReview() {
  const [settings, setSettings] = useState<PRGeneratorSettings | null>(null);
  const [rows, setRows] = useState<PRItem[] | null>(null);
  const [facts, setFacts] = useState<PRFactLibraryItem[] | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, PRDetails>>({});
  const [detailsOpenById, setDetailsOpenById] = useState<Record<string, boolean>>({});
  const [draftOpenById, setDraftOpenById] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const [intervalDays, setIntervalDays] = useState("30");
  const [active, setActive] = useState(true);

  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [draftImportText, setDraftImportText] = useState("");
  const [draftImportOpen, setDraftImportOpen] = useState(false);
  const [draftSectionOpen, setDraftSectionOpen] = useState(false);
  const [queueSectionOpen, setQueueSectionOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");

  const [factTitle, setFactTitle] = useState("");
  const [factCategory, setFactCategory] = useState("general");
  const [factContent, setFactContent] = useState("");
  const [factSourceUrl, setFactSourceUrl] = useState("");
  const [factImportText, setFactImportText] = useState("");
  const [factImportOpen, setFactImportOpen] = useState(false);
  const [factSectionOpen, setFactSectionOpen] = useState(false);

  const [publishForId, setPublishForId] = useState<string | null>(null);
  const [pubUrl, setPubUrl] = useState("");
  const [pubName, setPubName] = useState("");
  const [pubDate, setPubDate] = useState("");
  const [pubHeadline, setPubHeadline] = useState("");
  const [pubNotes, setPubNotes] = useState("");

  const load = async () => {
    setBusy("load");
    setMsg(null);
    const [s, r, f] = await Promise.all([getPRGeneratorSettings(), listPressReleases(), listPRFactLibrary()]);
    setBusy(null);

    if (!s.ok) {
      setMsg({ text: s.error, error: true });
      return;
    }
    if (!r.ok) {
      setMsg({ text: r.error, error: true });
      return;
    }
    if (!f.ok) {
      setMsg({ text: f.error, error: true });
      return;
    }

    setSettings(s.data);
    setRows(r.data);
    setFacts(f.data);
    setIntervalDays(String(s.data.intervalDays));
    setActive(s.data.active);
  };

  useEffect(() => {
    void load();
  }, []);

  const issueGroups: Array<{ key: keyof ComplianceChecks; label: string }> = [
    { key: "unsupportedClaims", label: "Unsupported claims" },
    { key: "fabricatedStatsOrAwards", label: "Fabricated stats/awards" },
    { key: "unverifiableQuotes", label: "Unverifiable quotes" },
    { key: "promotionalToneRisks", label: "Promotional tone risks" },
    { key: "duplicateAngleRisks", label: "Duplicate-angle risks" },
    { key: "keywordStuffingRisks", label: "Keyword stuffing risks" },
  ];

  const toggleDraft = (id: string) => {
    setDraftOpenById((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const grouped = useMemo(() => {
    const all = rows ?? [];
    return {
      draft: all.filter((x) => x.status === "draft"),
      reviewed: all.filter((x) => x.status === "reviewed"),
      approved: all.filter((x) => x.status === "approved"),
      published: all.filter((x) => x.status === "published_externally"),
      rejected: all.filter((x) => x.status === "rejected"),
    };
  }, [rows]);

  const saveSettings = async () => {
    setBusy("save-settings");
    setMsg(null);
    const res = await setPRGeneratorSettings({ intervalDays: Number(intervalDays), active });
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setSettings(res.data);
    setMsg({ text: "PR generator settings saved." });
  };

  const createDraft = async () => {
    if (!newTitle.trim()) return;
    setBusy("create");
    setMsg(null);
    const res = await createPressReleaseDraft({
      title: newTitle,
      summary: newSummary,
      topic: newTopic,
    });
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setNewTitle("");
    setNewSummary("");
    setNewTopic("");
    setMsg({ text: "PR draft created." });
    await load();
  };

  const generateAiDraft = async (force = false) => {
    setBusy(force ? "gen-ai-force" : "gen-ai");
    setMsg(null);
    const res = await generatePRNow({ topic: aiTopic.trim() || undefined, force });
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setAiTopic("");
    setMsg({ text: `AI draft generated: ${res.data.title} (${res.data.complianceStatus.toUpperCase()} compliance).` });
    await load();
  };

  const generateFromQueue = async (id: string) => {
    setBusy(`gen-queue:${id}`);
    setMsg(null);
    const res = await generatePRDraftFromQueue(id);
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setMsg({ text: `Draft generated from queue item: ${res.data.title}.` });
    await load();
  };

  const parseDraftRows = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [title, summary, topic] = line.split("|");
        return {
          title: (title ?? "").trim(),
          summary: (summary ?? "").trim(),
          topic: (topic ?? "").trim(),
        };
      })
      .filter((row) => row.title);

  const importDraftRows = async (rows: Array<{ title: string; summary?: string; topic?: string }>) => {
    if (rows.length === 0) {
      setMsg({ text: "No valid draft rows found.", error: true });
      return;
    }
    setBusy("draft-import");
    setMsg(null);
    const res = await createPressReleaseDraftsBulk(rows);
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setDraftImportText("");
    setMsg({ text: `Imported ${res.data.added} PR drafts${res.data.skipped ? `, skipped ${res.data.skipped}` : ""}.` });
    await load();
  };

  const importDraftFile = async (file: File) => {
    setBusy("draft-import");
    setMsg(null);
    try {
      const lower = file.name.toLowerCase();
      let rows: Array<{ title: string; summary?: string; topic?: string }> = [];
      if (lower.endsWith(".xlsx") || lower.endsWith(".csv")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        rows = table
          .map((r) => ({
            title: String(r?.[0] ?? "").trim(),
            summary: String(r?.[1] ?? "").trim(),
            topic: String(r?.[2] ?? "").trim(),
          }))
          .filter((r) => r.title && r.title.toLowerCase() !== "title");
      } else if (lower.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        rows = parseDraftRows(value);
      } else {
        rows = parseDraftRows(await file.text());
      }
      setBusy(null);
      await importDraftRows(rows);
    } catch {
      setBusy(null);
      setMsg({ text: "Could not parse PR draft file. Use .csv, .xlsx, .docx, or .txt.", error: true });
    }
  };

  const updateStatus = async (id: string, status: Exclude<PRStatus, "published_externally">, okText: string) => {
    setBusy(`${status}:${id}`);
    setMsg(null);
    const res = await setPressReleaseStatus(id, status);
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setMsg({ text: okText });
    await load();
  };

  const startPublishMeta = (id: string) => {
    setPublishForId(id);
    setPubUrl("");
    setPubName("");
    setPubDate("");
    setPubHeadline("");
    setPubNotes("");
  };

  const submitPublishMeta = async () => {
    if (!publishForId) return;
    setBusy(`publish:${publishForId}`);
    setMsg(null);
    const res = await markPublishedExternally(publishForId, {
      externalUrl: pubUrl,
      publicationName: pubName,
      publicationDate: pubDate,
      externalHeadline: pubHeadline,
      notes: pubNotes,
    });
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setPublishForId(null);
    setMsg({ text: "PR marked as published externally." });
    await load();
  };

  const addFact = async () => {
    setBusy("fact-add");
    setMsg(null);
    const res = await createPRFact({
      title: factTitle,
      category: factCategory,
      content: factContent,
      sourceUrl: factSourceUrl,
      active: true,
    });
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setFactTitle("");
    setFactCategory("general");
    setFactContent("");
    setFactSourceUrl("");
    setMsg({ text: "Fact added." });
    await load();
  };

  const toggleFact = async (id: string, activeNext: boolean) => {
    setBusy(`fact:${id}`);
    setMsg(null);
    const res = await setPRFactActive(id, activeNext);
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    await load();
  };

  const removeFact = async (id: string) => {
    setBusy(`factdel:${id}`);
    setMsg(null);
    const res = await deletePRFact(id);
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setMsg({ text: "Fact removed." });
    await load();
  };

  const parseFactRows = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [title, category, content, sourceUrl] = line.split("|");
        return {
          title: (title ?? "").trim(),
          category: (category ?? "general").trim() || "general",
          content: (content ?? "").trim(),
          sourceUrl: (sourceUrl ?? "").trim(),
        };
      })
      .filter((row) => row.title && row.content);

  const importFactRows = async (rows: Array<{ title: string; category?: string; content: string; sourceUrl?: string }>) => {
    if (rows.length === 0) {
      setMsg({ text: "No valid fact rows found.", error: true });
      return;
    }
    setBusy("fact-import");
    setMsg(null);
    const res = await createPRFactsBulk(rows);
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setFactImportText("");
    setMsg({ text: `Imported ${res.data.added} facts${res.data.skipped ? `, skipped ${res.data.skipped}` : ""}.` });
    await load();
  };

  const importFactFile = async (file: File) => {
    setBusy("fact-import");
    setMsg(null);
    try {
      const lower = file.name.toLowerCase();
      let rows: Array<{ title: string; category?: string; content: string; sourceUrl?: string }> = [];
      if (lower.endsWith(".xlsx") || lower.endsWith(".csv")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        rows = table
          .map((r) => ({
            title: String(r?.[0] ?? "").trim(),
            category: String(r?.[1] ?? "").trim() || "general",
            content: String(r?.[2] ?? "").trim(),
            sourceUrl: String(r?.[3] ?? "").trim(),
          }))
          .filter((r) => r.title && r.title.toLowerCase() !== "title" && r.content);
      } else if (lower.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        rows = parseFactRows(value);
      } else {
        rows = parseFactRows(await file.text());
      }
      setBusy(null);
      await importFactRows(rows);
    } catch {
      setBusy(null);
      setMsg({ text: "Could not parse fact file. Use .csv, .xlsx, .docx, or .txt.", error: true });
    }
  };

  const toggleDetails = async (id: string) => {
    const currentlyOpen = !!detailsOpenById[id];
    if (currentlyOpen) {
      setDetailsOpenById((prev) => ({ ...prev, [id]: false }));
      return;
    }

    setDetailsOpenById((prev) => ({ ...prev, [id]: true }));
    if (detailsById[id]) return;

    setBusy(`details:${id}`);
    setMsg(null);
    const res = await getPressReleaseDetails(id);
    setBusy(null);
    if (!res.ok) {
      setMsg({ text: res.error, error: true });
      return;
    }
    setDetailsById((prev) => ({ ...prev, [id]: res.data }));
  };

  const fmt = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim">
        <span className="fp-text">PR Generator:</span> superadmin workflow + AI draft generation + compliance + claim tracing.
        External publication is still manual by design.
      </div>

      {msg && (
        <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
          {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
        </p>
      )}

      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium flex items-center gap-2"><Megaphone size={15} className="fp-gold" /> PR generator settings</p>
          <button onClick={() => void load()} className="text-xs fp-gold flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="fp-text-dim text-xs fp-mono uppercase">Interval days</label>
            <input
              type="number"
              min={1}
              max={365}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
              className={inputCls}
            />
          </div>
          <label className="fp-panel-raised border fp-line-soft rounded-xl px-3 py-3 mt-5 sm:mt-0 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Auto-schedule active
          </label>
        </div>
        <p className="fp-text-faint text-xs">
          Next eligible date: <span className="fp-text">{settings?.nextGenerationDate ?? "—"}</span> · Last generated: <span className="fp-text">{fmt(settings?.lastGeneratedAt ?? null)}</span>
        </p>
        <button
          onClick={() => void saveSettings()}
          disabled={busy === "save-settings"}
          className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
        >
          {busy === "save-settings" ? "Saving…" : "Save settings"}
        </button>
      </div>

      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <button onClick={() => setDraftSectionOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <p className="text-sm font-medium">Create PR draft</p>
          <ChevronDown size={14} className={`fp-text-faint transition-transform ${draftSectionOpen ? "rotate-180" : ""}`} />
        </button>
        {draftSectionOpen && (
          <>
            <div className="space-y-2">
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Title</label>
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className={inputCls} placeholder="Press release title" />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Summary</label>
                <textarea value={newSummary} onChange={(e) => setNewSummary(e.target.value)} rows={3} className={inputCls} placeholder="Short PR summary" />
              </div>
              <div>
                <label className="fp-text-dim text-xs fp-mono uppercase">Topic (optional)</label>
                <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} className={inputCls} placeholder="Campaign topic" />
              </div>
            </div>
            <button
              onClick={() => void createDraft()}
              disabled={busy === "create" || !newTitle.trim()}
              className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> {busy === "create" ? "Creating…" : "Create draft"}
            </button>

            <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 space-y-2">
              <button
                onClick={() => setDraftImportOpen((v) => !v)}
                className="w-full flex items-center justify-between text-left"
              >
                <p className="fp-text-faint text-[11px] fp-mono uppercase">Import draft topics (title | summary | topic)</p>
                <ChevronDown size={14} className={`fp-text-faint transition-transform ${draftImportOpen ? "rotate-180" : ""}`} />
              </button>
              {draftImportOpen && (
                <>
                  <textarea
                    value={draftImportText}
                    onChange={(e) => setDraftImportText(e.target.value)}
                    rows={3}
                    className={`${inputCls} font-mono`}
                    placeholder={"One row per line\nTitle | Summary | Topic\nLaunches AI PR Generator for Superadmin | New workflow is live | Product updates"}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void importDraftRows(parseDraftRows(draftImportText))}
                      disabled={busy === "draft-import" || !draftImportText.trim()}
                      className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60"
                    >
                      {busy === "draft-import" ? "Importing…" : "Import pasted"}
                    </button>
                    <label className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-2 hover:fp-text cursor-pointer">
                      Upload file
                      <input
                        type="file"
                        accept=".csv,.txt,.xlsx,.docx"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void importDraftFile(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <span className="fp-text-faint text-[11px]">.csv/.xlsx: col A=title, B=summary, C=topic · .txt/.docx: one line per row</span>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <p className="text-sm font-medium">Generate AI draft</p>
        <p className="fp-text-faint text-xs">Uses active Fact Library entries and runs a compliance pass automatically.</p>
        <input
          value={aiTopic}
          onChange={(e) => setAiTopic(e.target.value)}
          className={inputCls}
          placeholder="Optional topic override (blank = auto from facts)"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => void generateAiDraft(false)}
            disabled={busy === "gen-ai" || busy === "gen-ai-force"}
            className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {busy === "gen-ai" ? "Generating…" : "Generate AI draft"}
          </button>
          <button
            onClick={() => void generateAiDraft(true)}
            disabled={busy === "gen-ai" || busy === "gen-ai-force"}
            className="text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 disabled:opacity-60"
          >
            {busy === "gen-ai-force" ? "Generating…" : "Force generate (override unpublished block)"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <button onClick={() => setQueueSectionOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <p className="text-sm font-medium">PR queue</p>
          <ChevronDown size={14} className={`fp-text-faint transition-transform ${queueSectionOpen ? "rotate-180" : ""}`} />
        </button>
        {queueSectionOpen && (rows === null ? (
          <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="fp-text-faint text-sm py-4">No press releases yet.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const showPublish = publishForId === row.id;
              return (
                <div key={row.id} className="fp-panel border fp-line rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{row.title}</p>
                      <p className="fp-text-faint text-xs fp-mono mt-0.5">/{row.slug} · {fmt(row.createdAt)}</p>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full ${statusTone[row.status]}`}>{statusLabel[row.status]}</span>
                  </div>
                  {row.summary && <p className="fp-text-dim text-sm mt-2 leading-relaxed">{row.summary}</p>}

                  {row.externalUrl && (
                    <a href={row.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs fp-gold hover:underline">
                      External publication <ExternalLink size={11} />
                    </a>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleDraft(row.id)}
                      className="text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5"
                    >
                      {draftOpenById[row.id] ? "Hide draft" : "Open draft"}
                    </button>
                    <button
                      onClick={() => void generateFromQueue(row.id)}
                      disabled={busy === `gen-queue:${row.id}` || row.status === "published_externally"}
                      className="text-xs fp-btn-primary rounded-lg px-3 py-1.5 disabled:opacity-60"
                    >
                      {busy === `gen-queue:${row.id}` ? "Generating…" : "Generate draft from queue"}
                    </button>
                    <button
                      onClick={() => void toggleDetails(row.id)}
                      disabled={busy === `details:${row.id}`}
                      className="text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60"
                    >
                      {busy === `details:${row.id}`
                        ? "Loading details…"
                        : detailsOpenById[row.id]
                          ? "Hide compliance & claims"
                          : "View compliance & claims"}
                    </button>
                    {row.status !== "reviewed" && row.status !== "published_externally" && (
                      <button
                        onClick={() => void updateStatus(row.id, "reviewed", "Marked as reviewed.")}
                        disabled={busy === `reviewed:${row.id}`}
                        className="text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60"
                      >
                        Mark reviewed
                      </button>
                    )}
                    {row.status !== "approved" && row.status !== "published_externally" && (
                      <button
                        onClick={() => void updateStatus(row.id, "approved", "Marked as approved.")}
                        disabled={busy === `approved:${row.id}`}
                        className="text-xs fp-safe-soft-bg fp-safe rounded-lg px-3 py-1.5 disabled:opacity-60"
                      >
                        Approve
                      </button>
                    )}
                    {row.status !== "rejected" && row.status !== "published_externally" && (
                      <button
                        onClick={() => void updateStatus(row.id, "rejected", "Marked as rejected.")}
                        disabled={busy === `rejected:${row.id}`}
                        className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    )}
                    {row.status !== "published_externally" && (
                      <button
                        onClick={() => startPublishMeta(row.id)}
                        className="text-xs fp-gold-soft-bg fp-gold rounded-lg px-3 py-1.5"
                      >
                        Mark published externally
                      </button>
                    )}
                    {row.status !== "draft" && row.status !== "published_externally" && (
                      <button
                        onClick={() => void updateStatus(row.id, "draft", "Moved back to draft.")}
                        disabled={busy === `draft:${row.id}`}
                        className="text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60"
                      >
                        Move to draft
                      </button>
                    )}
                  </div>

                  {draftOpenById[row.id] && (
                    <div className="mt-4 border-t fp-line-soft pt-4 space-y-2">
                      <p className="text-xs fp-mono uppercase fp-text-dim">Draft body</p>
                      {row.body.length === 0 ? (
                        <p className="fp-text-faint text-xs">No draft body blocks yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {row.body.map((block, idx) => {
                            if ((block.kind === "ul" || block.kind === "ol") && block.items?.length) {
                              const ListTag = block.kind;
                              return (
                                <ListTag key={`${row.id}-body-${idx}`} className="list-disc pl-5 text-sm fp-text-dim space-y-1">
                                  {block.items.map((item, itemIdx) => (
                                    <li key={`${row.id}-body-${idx}-item-${itemIdx}`}>{item}</li>
                                  ))}
                                </ListTag>
                              );
                            }
                            if (block.kind === "h3") {
                              return <h4 key={`${row.id}-body-${idx}`} className="text-sm font-semibold">{block.text}</h4>;
                            }
                            if (block.kind === "quote") {
                              return (
                                <blockquote key={`${row.id}-body-${idx}`} className="border-l-2 fp-line-soft pl-3 italic text-sm fp-text-dim">
                                  {block.text}
                                </blockquote>
                              );
                            }
                            return <p key={`${row.id}-body-${idx}`} className="text-sm fp-text-dim leading-relaxed">{block.text}</p>;
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {showPublish && (
                    <div className="mt-4 border-t fp-line-soft pt-4 space-y-2">
                      <p className="text-xs fp-text-dim">External publication metadata (required URL + date)</p>
                      <input value={pubUrl} onChange={(e) => setPubUrl(e.target.value)} placeholder="https://openpr.com/news/..." className={inputCls} />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input value={pubName} onChange={(e) => setPubName(e.target.value)} placeholder="Publication name" className={inputCls} />
                        <input type="date" value={pubDate} onChange={(e) => setPubDate(e.target.value)} className={inputCls} />
                      </div>
                      <input value={pubHeadline} onChange={(e) => setPubHeadline(e.target.value)} placeholder="External headline (optional)" className={inputCls} />
                      <textarea value={pubNotes} onChange={(e) => setPubNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className={inputCls} />
                      <div className="flex gap-2">
                        <button
                          onClick={() => void submitPublishMeta()}
                          disabled={busy === `publish:${row.id}`}
                          className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
                        >
                          {busy === `publish:${row.id}` ? "Saving…" : "Confirm published"}
                        </button>
                        <button
                          onClick={() => setPublishForId(null)}
                          className="text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {detailsOpenById[row.id] && (
                    <div className="mt-4 border-t fp-line-soft pt-4 space-y-3">
                      {!detailsById[row.id] ? (
                        <p className="fp-text-faint text-xs">Loading detail view…</p>
                      ) : (
                        <>
                          {(() => {
                            const details = detailsById[row.id];
                            const report = details.latestCompliance;
                            return (
                              <>
                                <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 space-y-2">
                                  <p className="text-xs fp-mono uppercase fp-text-dim">Latest compliance report</p>
                                  {report ? (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <span className={`text-xs px-2 py-1 rounded-full ${report.status === "pass" ? "fp-safe-soft-bg fp-safe" : "text-red-400 border border-red-500/30"}`}>
                                          {report.status.toUpperCase()}
                                        </span>
                                        <span className="fp-text-faint text-xs">{fmt(report.createdAt)}</span>
                                      </div>
                                      <p className="text-sm fp-text-dim">{report.summary}</p>
                                      <div className="space-y-2">
                                        {issueGroups.map((group) => {
                                          const items: string[] = report.checks[group.key] ?? [];
                                          return (
                                            <div key={group.key}>
                                              <p className="text-xs fp-text-dim">{group.label}: <span className="fp-text">{items.length}</span></p>
                                              {items.length > 0 && (
                                                <ul className="mt-1 space-y-1 list-disc pl-4 text-xs fp-text-faint">
                                                  {items.map((item: string, idx: number) => (
                                                    <li key={`${group.key}-${idx}`}>{item}</li>
                                                  ))}
                                                </ul>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </>
                                  ) : (
                                    <p className="fp-text-faint text-xs">No compliance report recorded yet for this PR.</p>
                                  )}
                                </div>

                                <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 space-y-2">
                                  <p className="text-xs fp-mono uppercase fp-text-dim">Claim traceability</p>
                                  {details.claims.length === 0 ? (
                                    <p className="fp-text-faint text-xs">No claim-source rows recorded yet.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {details.claims.map((claim) => (
                                        <div key={claim.id} className="border fp-line-soft rounded-lg p-2">
                                          <p className="text-xs fp-text">{claim.claimText}</p>
                                          <p className="text-[11px] fp-text-faint mt-1">
                                            Fact: {claim.factTitle ?? "(not linked)"}
                                            {typeof claim.confidence === "number" ? ` · Confidence: ${claim.confidence.toFixed(2)}` : ""}
                                          </p>
                                          {claim.sourceUrl && (
                                            <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] fp-gold inline-flex items-center gap-1 mt-1">
                                              Source <ExternalLink size={10} />
                                            </a>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="fp-panel border fp-line rounded-2xl p-4 space-y-2">
        <p className="text-sm font-medium">Quick status counts</p>
        <p className="text-xs fp-text-dim">
          Draft: <span className="fp-text">{grouped.draft.length}</span> · Reviewed: <span className="fp-text">{grouped.reviewed.length}</span> · Approved: <span className="fp-text">{grouped.approved.length}</span> · Published externally: <span className="fp-text">{grouped.published.length}</span> · Rejected: <span className="fp-text">{grouped.rejected.length}</span>
        </p>
      </div>

      <div className="fp-panel border fp-line rounded-2xl p-5 space-y-3">
        <button onClick={() => setFactSectionOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <p className="text-sm font-medium">PR Fact Library</p>
          <ChevronDown size={14} className={`fp-text-faint transition-transform ${factSectionOpen ? "rotate-180" : ""}`} />
        </button>
        {factSectionOpen && (
          <>
            <p className="fp-text-faint text-xs">Only active facts are used for AI drafting/compliance checks.</p>
            <div className="space-y-2">
              <input value={factTitle} onChange={(e) => setFactTitle(e.target.value)} className={inputCls} placeholder="Fact title" />
              <input value={factCategory} onChange={(e) => setFactCategory(e.target.value)} className={inputCls} placeholder="Category" />
              <textarea value={factContent} onChange={(e) => setFactContent(e.target.value)} rows={3} className={inputCls} placeholder="Factual content (no marketing fluff)" />
              <input value={factSourceUrl} onChange={(e) => setFactSourceUrl(e.target.value)} className={inputCls} placeholder="Source URL (optional)" />
              <button
                onClick={() => void addFact()}
                disabled={busy === "fact-add" || !factTitle.trim() || !factContent.trim()}
                className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
              >
                {busy === "fact-add" ? "Adding…" : "Add fact"}
              </button>
            </div>

            <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 space-y-2">
              <button
                onClick={() => setFactImportOpen((v) => !v)}
                className="w-full flex items-center justify-between text-left"
              >
                <p className="fp-text-faint text-[11px] fp-mono uppercase">Import facts (title | category | content | source url)</p>
                <ChevronDown size={14} className={`fp-text-faint transition-transform ${factImportOpen ? "rotate-180" : ""}`} />
              </button>
              {factImportOpen && (
                <>
                  <textarea
                    value={factImportText}
                    onChange={(e) => setFactImportText(e.target.value)}
                    rows={3}
                    className={`${inputCls} font-mono`}
                    placeholder={"One row per line\nTitle | Category | Content | Source URL\nMain launch date | roadmap | Launch announced for Sept 2026 | https://example.com/post"}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void importFactRows(parseFactRows(factImportText))}
                      disabled={busy === "fact-import" || !factImportText.trim()}
                      className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60"
                    >
                      {busy === "fact-import" ? "Importing…" : "Import pasted"}
                    </button>
                    <label className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-2 hover:fp-text cursor-pointer">
                      Upload file
                      <input
                        type="file"
                        accept=".csv,.txt,.xlsx,.docx"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void importFactFile(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <span className="fp-text-faint text-[11px]">.csv/.xlsx: A=title, B=category, C=content, D=source URL · .txt/.docx line format supported</span>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2">
              {(facts ?? []).length === 0 ? (
                <p className="fp-text-faint text-sm">No facts yet.</p>
              ) : (
                (facts ?? []).map((fact) => (
                  <div key={fact.id} className="fp-panel-raised border fp-line-soft rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{fact.title}</p>
                        <p className="fp-text-faint text-xs">{fact.category} · {fact.active ? "active" : "inactive"}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => void toggleFact(fact.id, !fact.active)}
                          disabled={busy === `fact:${fact.id}`}
                          className="text-xs fp-panel border fp-line-soft rounded-lg px-2 py-1 disabled:opacity-60"
                        >
                          {fact.active ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => void removeFact(fact.id)}
                          disabled={busy === `factdel:${fact.id}`}
                          className="text-xs text-red-400 border border-red-500/30 rounded-lg px-2 py-1 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="fp-text-dim text-sm mt-2 whitespace-pre-wrap">{fact.content}</p>
                    {fact.sourceUrl && (
                      <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className="text-xs fp-gold inline-flex items-center gap-1 mt-2">
                        Source <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
