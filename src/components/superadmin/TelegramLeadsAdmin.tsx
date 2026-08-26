"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, Search, Download, Trash2, ExternalLink, Users, ListPlus } from "lucide-react";
import { Pill } from "@/src/components/ui";
import {
  listTelegramLeads, runTelegramLeadScrape, setTelegramLeadStatus, setTelegramLeadNotes,
  deleteTelegramLead, importTelegramLeadsCsv,
  type TelegramLead, type TelegramLeadStatus, type ScrapeSummary,
} from "@/src/lib/actions/telegram-leads";

/**
 * Super-admin Telegram lead-research tool. Scrapes a PUBLIC third-party
 * Telegram directory site (tlgrm.eu's own category listing pages -- never
 * Telegram itself, never private/joined-group data) into a manual-outreach
 * lead list. This tool never sends a message anywhere -- it only helps a
 * human on Innvil's team find and track real, publicly-listed Telegram
 * communities to reach out to by hand. Shared by the /superadmin route
 * (Telegram Leads tab) and the owner-app sidebar (super-admin accounts).
 */

const CATEGORY_OPTIONS = [
  { value: "crypto", label: "Crypto" },
  { value: "business", label: "Business" },
  { value: "tech", label: "Tech" },
  { value: "gaming", label: "Gaming" },
  { value: "education", label: "Education" },
  { value: "news", label: "News" },
  { value: "blogs", label: "Blogs" },
  { value: "other", label: "Other" },
];

const STATUS_TONE: Record<TelegramLeadStatus, "gold" | "violet" | "safe" | "danger" | "muted"> = {
  new: "gold", contacted: "violet", responded: "violet", converted: "safe", declined: "danger", invalid: "muted",
};

const STATUS_OPTIONS: TelegramLeadStatus[] = ["new", "contacted", "responded", "converted", "declined", "invalid"];

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function downloadCsv(leads: TelegramLead[]) {
  const header = ["name", "username", "link", "subscribers", "category", "status", "notes"];
  const rows = leads.map((l) => [l.name, l.username, l.link, l.subscriberCount ?? "", l.category ?? "", l.status, l.notes ?? ""]);
  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `telegram-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parses the manual paste-import textarea: one lead per line,
 *  `name, @username, subscribers, category, description` (subscribers/
 *  category/description optional, trailing fields may be omitted). */
function parseManualRows(text: string): Array<{ name: string; username: string; subscriberCount?: number; category?: string; description?: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const [name, usernameRaw, subsRaw, category, ...rest] = parts;
      const subs = subsRaw ? Number(subsRaw.replace(/[^\d]/g, "")) : undefined;
      return {
        name: name ?? "",
        username: (usernameRaw ?? "").replace(/^@/, ""),
        subscriberCount: subs && Number.isFinite(subs) ? subs : undefined,
        category: category || undefined,
        description: rest.length ? rest.join(",").trim() || undefined : undefined,
      };
    })
    .filter((r) => r.name && r.username);
}

export function TelegramLeadsAdmin() {
  const [leads, setLeads] = useState<TelegramLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TelegramLeadStatus | "">("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");

  const [selectedCategories, setSelectedCategories] = useState<string[]>(["crypto"]);
  const [maxPages, setMaxPages] = useState(3);
  const [scraping, setScraping] = useState(false);
  const [scrapeSummary, setScrapeSummary] = useState<ScrapeSummary | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const [manualText, setManualText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);

  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  async function refresh() {
    setLoading(true);
    const rows = await listTelegramLeads({
      status: statusFilter || undefined,
      category: categoryFilter || undefined,
      search: search || undefined,
    });
    setLeads(rows);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [statusFilter, categoryFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSearch() {
    await refresh();
  }

  async function runScrape() {
    setScraping(true);
    setScrapeError(null);
    setScrapeSummary(null);
    const res = await runTelegramLeadScrape(selectedCategories, maxPages);
    setScraping(false);
    if (!res.ok) { setScrapeError(res.error); return; }
    setScrapeSummary(res.data);
    await refresh();
  }

  async function runImport() {
    const rows = parseManualRows(manualText);
    if (rows.length === 0) return;
    setImporting(true);
    setImportResult(null);
    const res = await importTelegramLeadsCsv(rows);
    setImporting(false);
    if (res.ok) {
      setImportResult(res.data);
      setManualText("");
      await refresh();
    }
  }

  async function changeStatus(id: string, status: TelegramLeadStatus) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    await setTelegramLeadStatus(id, status);
  }

  async function saveNotes(id: string) {
    const notes = notesDraft[id] ?? "";
    await setTelegramLeadNotes(id, notes);
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, notes } : l)));
  }

  async function removeLead(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    await deleteTelegramLead(id);
  }

  return (
    <div className="space-y-6">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Users size={16} className="fp-gold" />
          <h2 className="fp-display text-base">Find Telegram communities</h2>
        </div>
        <p className="fp-text-dim text-xs mb-4">
          Pulls publicly-listed channels/groups from tlgrm.eu&apos;s own public directory pages — real, already-
          public data (name, @username, subscriber count, description). This never messages anyone; it only
          builds a lead list for your team to research and reach out to manually.
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          {CATEGORY_OPTIONS.map((c) => {
            const active = selectedCategories.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() =>
                  setSelectedCategories((prev) => (active ? prev.filter((v) => v !== c.value) : [...prev, c.value]))
                }
                className={`text-xs px-3 py-1.5 rounded-full border ${active ? "fp-gold-soft-bg fp-gold fp-gold-border" : "fp-line-soft fp-text-dim"}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs fp-text-dim flex items-center gap-2">
            Max pages per category
            <input
              type="number" min={1} max={5} value={maxPages}
              onChange={(e) => setMaxPages(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
              className="w-16 fp-panel-raised border fp-line-soft rounded-lg px-2 py-1"
            />
          </label>
          <button
            onClick={() => void runScrape()}
            disabled={scraping || selectedCategories.length === 0}
            className="fp-btn-primary rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={scraping ? "animate-spin" : ""} /> {scraping ? "Scraping…" : "Run scrape"}
          </button>
        </div>

        {scrapeError && <p className="text-xs text-red-400 mt-3">{scrapeError}</p>}
        {scrapeSummary && (
          <div className="mt-3 text-xs fp-text-dim space-y-1">
            <p>Added {scrapeSummary.added}, updated {scrapeSummary.updated} existing lead(s).</p>
            {scrapeSummary.perCategory.map((c) => (
              <p key={c.category}>
                {c.category}: {c.found} found across {c.pagesFetched} page(s){c.error ? ` — ${c.error}` : ""}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="fp-panel-raised border fp-line-soft rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <ListPlus size={16} className="fp-gold" />
          <h2 className="fp-display text-base">Manual import</h2>
        </div>
        <p className="fp-text-dim text-xs mb-3">
          One lead per line: <code>Name, @username, subscribers, category, description</code> (only Name and
          @username are required). Use this for leads researched from elsewhere.
        </p>
        <textarea
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder={"My Crypto Group, @mycryptogroup, 4200, crypto, A community for X"}
          rows={4}
          className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border font-mono"
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => void runImport()}
            disabled={importing || manualText.trim().length === 0}
            className="fp-panel-raised border fp-line-soft rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
          {importResult && (
            <p className="text-xs fp-text-dim">Added {importResult.added}, skipped {importResult.skipped} (blank/duplicate).</p>
          )}
        </div>
      </div>

      <div className="fp-panel-raised border fp-line-soft rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="fp-display text-base">Leads ({leads.length})</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 fp-panel-raised border fp-line-soft rounded-lg px-2.5 py-1.5">
              <Search size={13} className="fp-text-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
                placeholder="Search name/username"
                className="bg-transparent text-xs outline-none w-36"
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TelegramLeadStatus | "")} className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1.5 text-xs">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1.5 text-xs">
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <button onClick={() => void runSearch()} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 text-xs">Search</button>
            <button onClick={() => downloadCsv(leads)} disabled={leads.length === 0} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-1.5 text-xs flex items-center gap-1 disabled:opacity-50">
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>

        {loading ? (
          <p className="fp-text-faint text-sm">Loading…</p>
        ) : leads.length === 0 ? (
          <p className="fp-text-faint text-sm">No leads yet — run a scrape or import some above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left fp-text-faint border-b fp-line-soft">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Subs</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b fp-line-soft align-top">
                    <td className="py-2 pr-3">
                      <a href={l.link} target="_blank" rel="noreferrer" className="fp-gold flex items-center gap-1">
                        {l.name} <ExternalLink size={10} />
                      </a>
                      <p className="fp-text-faint">@{l.username}</p>
                      {l.description && <p className="fp-text-faint mt-0.5 max-w-xs">{l.description}</p>}
                    </td>
                    <td className="py-2 pr-3">{formatCount(l.subscriberCount)}</td>
                    <td className="py-2 pr-3">{l.category ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={l.status}
                        onChange={(e) => void changeStatus(l.id, e.target.value as TelegramLeadStatus)}
                        className="fp-panel-raised border fp-line-soft rounded-lg px-1.5 py-1 text-[11px]"
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <div className="mt-1"><Pill tone={STATUS_TONE[l.status]}>{l.status}</Pill></div>
                    </td>
                    <td className="py-2 pr-3 min-w-[160px]">
                      <input
                        value={notesDraft[l.id] ?? l.notes ?? ""}
                        onChange={(e) => setNotesDraft((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        onBlur={() => void saveNotes(l.id)}
                        placeholder="Add a note…"
                        className="w-full fp-panel-raised border fp-line-soft rounded-lg px-2 py-1 text-[11px]"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <button onClick={() => void removeLead(l.id)} className="text-red-400 hover:text-red-300">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
