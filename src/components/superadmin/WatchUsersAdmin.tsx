"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Card } from "@/src/components/ui";
import { listWatchUsersForSuperAdmin } from "@/src/lib/actions/superadmin-watch-users";
import { WATCH_USERS_PAGE_SIZE, watchUserStatus, type WatchUsersData } from "@/src/lib/superadmin/watch-users";

function date(value: string) {
  return new Date(value).toLocaleString();
}

export function WatchUsersAdmin() {
  const [data, setData] = useState<WatchUsersData | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [recentDays, setRecentDays] = useState(0);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listWatchUsersForSuperAdmin({ search: query, recentDays, page }).then(result => {
      if (cancelled) return;
      if (result.ok) setData(result.data);
      else { setData(null); setError(result.error); }
    }).catch(() => {
      if (!cancelled) { setData(null); setError("Could not load Watch users. Please retry."); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, recentDays, page, refresh]);
  const buttonClass = "border fp-line-soft px-3 py-2 rounded-lg text-sm disabled:opacity-40";
  return <Card title="Innvil Watch users" icon={Users}>
    <div className="space-y-5">
      <p className="text-sm fp-text-dim">Newest Watch accounts first. Existing shared accounts appear when they have recorded Watch activity; new Watch signups are also included before setup. First Watch activity is not necessarily the original account signup date. Access below covers direct Watch subscriptions and trials; legacy Forge-panel add-on access is managed under Forge panels.</p>
      {data && <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="All known Watch accounts">
        {[["Known Watch users", data.summary.total], ["New in 7 days", data.summary.new7Days], ["New in 30 days", data.summary.new30Days], ["Active direct subscriptions / grants", data.summary.activeSubscriptions], ["Active trials", data.summary.activeTrials]].map(([label, value]) =>
          <div key={label} className="rounded-lg border fp-line-soft p-3"><p className="text-xs fp-text-dim">{label}</p><p className="text-2xl fp-gold">{value}</p></div>)}
      </div>}
      <form className="flex flex-wrap gap-2 items-end" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()); setRefresh(v => v + 1); }}>
        <label className="text-xs fp-text-dim space-y-1 flex-1 min-w-48">Search email, name or account ID
          <input className="block w-full border fp-line-soft fp-panel-raised rounded-lg p-2 text-sm" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} />
        </label>
        <label className="text-xs fp-text-dim space-y-1">First recorded in Watch
          <select className="block border fp-line-soft fp-panel-raised rounded-lg p-2 text-sm" value={recentDays} onChange={e => { setRecentDays(Number(e.target.value)); setPage(1); }}>
            <option value={0}>All time</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
          </select>
        </label>
        <button className={buttonClass} type="submit">Search / refresh</button>
      </form>
      {loading && <p role="status" className="text-sm fp-text-dim">Loading Watch users…</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {!loading && data && <>
        <p className="text-xs fp-text-dim">{data.total} matching accounts · Summary counts above include all known Watch accounts.</p>
        {data.users.length === 0 ? <p className="text-sm">No Watch accounts match these filters.</p> : <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="fp-text-dim"><tr>{["Account", "First seen in Watch", "Access", "Verification", "Saved watchers"].map(label => <th key={label} scope="col" className="p-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{data.users.map(user => <tr key={user.id} className="border-t fp-line-soft align-top">
              <td className="p-3"><p>{user.displayName || "Unnamed account"}</p><p className="fp-text-dim break-all">{user.email || "No email"}</p><p className="text-xs fp-text-faint break-all">{user.id}</p><p className="text-xs fp-text-dim mt-1">Innvil signup: {date(user.registeredAt)}</p></td>
              <td className="p-3"><p>{date(user.firstWatchAt)}</p><p className="text-xs fp-text-dim">{user.discovery === "signup" ? "Watch signup" : "Recorded Watch activity"}</p></td>
              <td className="p-3"><p>{watchUserStatus(user)}</p>{user.tier && <p className="fp-text-dim">{user.tier}</p>}{user.periodEnd && <p className="text-xs fp-text-dim">Plan end: {date(user.periodEnd)}</p>}{user.trialEndsAt && <p className="text-xs fp-text-dim">Trial end: {date(user.trialEndsAt)}</p>}</td>
              <td className="p-3 text-xs"><p>Email: {user.emailConfirmed ? "confirmed" : "unconfirmed"}</p><p>Telegram: {user.telegramVerified ? "verified" : "not linked"}</p></td>
              <td className="p-3">{user.watcherCount}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <div className="flex items-center gap-3">
          <button className={buttonClass} disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Previous</button>
          <span className="text-xs">Page {page} of {Math.max(1, Math.ceil(data.total / WATCH_USERS_PAGE_SIZE))}</span>
          <button className={buttonClass} disabled={page * WATCH_USERS_PAGE_SIZE >= data.total} onClick={() => setPage(v => v + 1)}>Next</button>
        </div>
      </>}
    </div>
  </Card>;
}
