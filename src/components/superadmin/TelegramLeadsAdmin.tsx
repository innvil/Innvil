"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, Search, Download, Trash2, ExternalLink, Users, ListPlus, Landmark } from "lucide-react";
import { Pill } from "@/src/components/ui";
import {
  listTelegramLeads, runTelegramLeadScrape, runVcSheetScrape, setTelegramLeadStatus, setTelegramLeadNotes,
  deleteTelegramLead, importTelegramLeadsCsv,
  type TelegramLead, type TelegramLeadStatus, type ScrapeSummary, type VcScrapeSummary, type LeadPlatform,
} from "@/src/lib/actions/telegram-leads";
import { TELEGRAM_LEAD_MIN_MEMBERS, TELEGRAM_LEAD_MAX_MEMBERS } from "@/src/lib/marketing/telegram-directory";

/**
 * Super-admin lead-research tool -- currently focused on VC (venture
 * capital) outreach, per explicit product direction. Two real, verified
 * public sources feed one shared lead list:
 *  - Telegram communities (tlgrm.eu's own public directory pages) -- never
 *    Telegram itself, never private/joined-group data.
 *  - VC firms (Wikipedia's "List of venture capital firms" + each firm's
 *    own article) -- real firm name/website/headquarters/founding year,
 *    from a source with no AI-crawler exclusion (unlike the retired
 *    vcsheet.com source, whose robots.txt explicitly disallows AI agents).
 * This tool never sends a message anywhere -- it only helps a human on
 * Innvil's team find and track real leads to reach out to manually.
 * Removal is PERMANENT: a deleted lead's identifier is recorded so it can
 * never be silently re-added by a later scrape/import. Shared by the
 * /superadmin route (Leads tab) and the owner-app sidebar (super-admin
 * accounts).
 */

const CATEGORY_OPTIONS = [
  { value: "business", label: "Business" },
  { value: "crypto", label: "Crypto" },
  { value: "tech", label: "Tech" },
  { value: "gaming", label: "Gaming" },
  { value: "education", label: "Education" },
  { value: "news", label: "News" },
  { value: "blogs", label: "Blogs" },
  { value: "other", label: "Other" },
];

const VC_CATEGORY_LABELS: Record<string, string> = {
  vc_firm: "VC firm",
};

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
  const header = ["name", "username", "link", "platform", "subscribers", "category", "status", "notes"];
  const rows = leads.map((l) => [l.name, l.username, l.link, l.platform, l.subscriberCount ?? "", l.category ?? "", l.status, l.notes ?? ""]);
  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
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
  const [platformFilter, setPlatformFilter] = useState<LeadPlatform | "">("");
  const [search, setSearch] = useState("");

  const [selectedCategories, setSelectedCategories] = useState<string[]>(["business"]);
  const [maxPages, setMaxPages] = useState(3);
  const [scraping, setScraping] = useState(false);
  const [scrapeSummary, setScrapeSummary] = useState<ScrapeSummary | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const [maxFirms, setMaxFirms] = useState(25);
  const [vcScraping, setVcScraping] = useState(false);
  const [vcScrapeSummary, setVcScrapeSummary] = useState<VcScrapeSummary | null>(null);
  const [vcScrapeError, setVcScrapeError] = useState<string | null>(null);

  const [manualText, setManualText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);

  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  async function refresh() {
    setLoading(true);
    const rows = await listTelegramLeads({
      status: statusFilter || undefined,
      category: categoryFilter || undefined,
      platform: platformFilter || undefined,
      search: search || undefined,
    });
    setLeads(rows);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [statusFilter, categoryFilter, platformFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function runVcScrape() {
    setVcScraping(true);
    setVcScrapeError(null);
    setVcScrapeSummary(null);
    const res = await runVcSheetScrape(maxFirms);
    setVcScraping(false);
    if (!res.ok) { setVcScrapeError(res.error); return; }
    setVcScrapeSummary(res.data);
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
    if (!window.confirm("Remove this lead permanently? It will never be re-added by a future scrape or import.")) return;
    setLeads((prev) => prev.filter((l) => l.id !== id));
    await deleteTelegramLead(id);
  }

  return (
    <div className="space-y-6">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Landmark size={16} className="fp-gold" />
          <h2 className="fp-display text-base">Find VC firms</h2>
        </div>
        <p className="fp-text-dim text-xs mb-1">
          Pulls real, publicly-listed VC firms from Wikipedia&apos;s &quot;List of venture capital firms&quot; page
          and each firm&apos;s own article — real name, website, headquarters, and founding year, when known. This
          never messages anyone; it only builds a lead list for your team to research and reach out to manually.
        </p>
        <p className="text-amber-400/90 text-xs mb-4">
          X/Twitter itself can&apos;t be scraped directly (it has no public, unauthenticated search — that would
          need a paid X API key), and this source has no reliable X-handle field to surface. A firm&apos;s Wikipedia
          article that isn&apos;t genuinely tagged &quot;Venture capital&quot; as its industry (a city, an unrelated
          organization, etc.) is automatically rejected, never added as a fake lead.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs fp-text-dim flex items-center gap-2">
            Max firms this run
            <input
              type="number" min={1} max={40} value={maxFirms}
              onChange={(e) => setMaxFirms(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
              className="w-16 fp-panel-raised border fp-line-soft rounded-lg px-2 py-1"
            />
          </label>
          <button
            onClick={() => void runVcScrape()}
            disabled={vcScraping}
            className="fp-btn-primary rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={vcScraping ? "animate-spin" : ""} /> {vcScraping ? "Scraping…" : "Run scrape"}
          </button>
        </div>

        {vcScrapeError && <p className="text-xs text-red-400 mt-3">{vcScrapeError}</p>}
        {vcScrapeSummary && (
          <div className="mt-3 text-xs fp-text-dim space-y-1">
            <p>
              Added {vcScrapeSummary.added}, updated {vcScrapeSummary.updated} existing lead(s)
              {vcScrapeSummary.excluded > 0 ? `, skipped ${vcScrapeSummary.excluded} previously removed` : ""}.
            </p>
            <p>
              {vcScrapeSummary.candidatesFound} firm(s) found on the list page, {vcScrapeSummary.firmsFetched} article(s)
              fetched, {vcScrapeSummary.rejected} rejected (not a genuine VC firm article or failed to fetch)
              {vcScrapeSummary.error ? ` — ${vcScrapeSummary.error}` : ""}.
            </p>
          </div>
        )}
      </div>

      <div className="fp-panel-raised border fp-line-soft rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Users size={16} className="fp-gold" />
          <h2 className="fp-display text-base">Find Telegram communities</h2>
        </div>
        <p className="fp-text-dim text-xs mb-1">
          Pulls publicly-listed communities from tlgrm.eu&apos;s own public directory pages — real, already-
          public data (name, @username, subscriber count, description). There&apos;s no dedicated VC category on
          this site — &quot;Business&quot; and &quot;Crypto&quot; are the closest real fits for VC-adjacent channels. This
          never messages anyone; it only builds a lead list for your team to research and reach out to manually.
        </p>
        <p className="fp-text-dim text-xs mb-1">
          Only kept as a lead when the site reports{" "}
          <span className="fp-text font-semibold">{TELEGRAM_LEAD_MIN_MEMBERS.toLocaleString()}–{TELEGRAM_LEAD_MAX_MEMBERS.toLocaleString()} members</span> —
          anything smaller, larger, or with no reported count is skipped automatically, not added and hidden later.
        </p>
        <p className="text-amber-400/90 text-xs mb-4">
          Heads up: tlgrm.eu only lists Telegram <span className="font-semibold">channels</span> (its own pages
          label every entry &quot;channel&quot; and it has no groups section) — every lead from this scraper is a
          channel, not a public group. If you need public-group-only leads specifically, a different directory
          source would need to be found and verified first.
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
            <p>
              Added {scrapeSummary.added}, updated {scrapeSummary.updated} existing lead(s)
              {scrapeSummary.outOfRange > 0 ? `, skipped ${scrapeSummary.outOfRange} outside the ${TELEGRAM_LEAD_MIN_MEMBERS.toLocaleString()}–${TELEGRAM_LEAD_MAX_MEMBERS.toLocaleString()} member range` : ""}
              {scrapeSummary.excluded > 0 ? `, skipped ${scrapeSummary.excluded} previously removed` : ""}.
            </p>
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
            <p className="text-xs fp-text-dim">Added {importResult.added}, skipped {importResult.skipped} (blank/duplicate/removed).</p>
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
            <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as LeadPlatform | "")} className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1.5 text-xs">
              <option value="">All sources</option>
              <option value="website">VC firms</option>
              <option value="telegram">Telegram</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TelegramLeadStatus | "")} className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1.5 text-xs">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1.5 text-xs">
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              <option value="vc_firm">{VC_CATEGORY_LABELS.vc_firm}</option>
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
                  <th className="py-2 pr-3">Source</th>
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
                      <p className="fp-text-faint">{l.platform === "website" ? l.link.replace(/^https?:\/\//, "") : `@${l.username}`}</p>
                      {l.description && <p className="fp-text-faint mt-0.5 max-w-xs">{l.description}</p>}
                    </td>
                    <td className="py-2 pr-3"><Pill tone={l.platform === "website" ? "violet" : "muted"}>{l.platform === "website" ? "VC firm" : "Telegram"}</Pill></td>
                    <td className="py-2 pr-3">{formatCount(l.subscriberCount)}</td>
                    <td className="py-2 pr-3">{VC_CATEGORY_LABELS[l.category ?? ""] ?? l.category ?? "—"}</td>
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
                      <button onClick={() => void removeLead(l.id)} title="Remove permanently" className="text-red-400 hover:text-red-300">
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
