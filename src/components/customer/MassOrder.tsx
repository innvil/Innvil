"use client";

import React, { useMemo, useState } from "react";
import {
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  X,
  Plus,
  ChevronDown,
  Star,
} from "lucide-react";
import { formatMoney } from "@/src/lib/money";
import { analyzeCampaign } from "@/src/lib/automation/links";
import { runMassOrder, type MassOrderResult } from "@/src/lib/actions/campaigns";
import { PLATFORMS, type CustomerService } from "@/src/data/constants";

type SelectedService = {
  service: CustomerService;
  quantity: string;
};

type PickerFilter = "all" | "favorites" | string;

function matchesNumericId(id: number, numericQuery: string): boolean {
  const sid = String(id);
  return sid.startsWith(numericQuery);
}

function serviceMatchesQuery(service: CustomerService, rawQuery: string): boolean {
  const q = rawQuery.trim();
  if (!q) return true;

  if (/^\d+$/.test(q)) {
    return matchesNumericId(service.id, q);
  }

  const platform = PLATFORMS.find((p) => p.key === service.platform);
  const haystack = [
    service.name,
    service.category,
    String(service.id),
    platform?.label ?? "",
    ...(platform?.aliases ?? []),
    ...(service.aliases ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export function MassOrder({
  panelId,
  currency = "USD",
  services = [],
  favoriteIds = [],
}: {
  panelId?: string;
  currency?: string;
  services?: CustomerService[];
  favoriteIds?: number[];
}) {
  const [targets, setTargets] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const [pickerFilter, setPickerFilter] = useState<PickerFilter>("all");
  const [selected, setSelected] = useState<SelectedService[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<MassOrderResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fmt = (n: number) => formatMoney(n, currency);
  const analysis = useMemo(() => analyzeCampaign(targets), [targets]);
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.service.id)), [selected]);

  const availablePlatformFilters = useMemo(() => {
    const keys = [...new Set(services.map((s) => s.platform).filter(Boolean))];
    return keys.slice(0, 6);
  }, [services]);

  const filterChips = useMemo(() => {
    const chips: Array<{ key: PickerFilter; label: string }> = [{ key: "all", label: "All" }];
    if (favoriteIds.length > 0) chips.push({ key: "favorites", label: "Favorites" });
    for (const key of availablePlatformFilters) {
      const p = PLATFORMS.find((x) => x.key === key);
      chips.push({ key, label: p?.label ?? key.charAt(0).toUpperCase() + key.slice(1) });
    }
    return chips;
  }, [availablePlatformFilters, favoriteIds]);

  const filterService = (s: CustomerService) => {
    if (pickerFilter === "all") return true;
    if (pickerFilter === "favorites") return favoriteIds.includes(s.id);
    return s.platform === pickerFilter;
  };

  const searchResults = useMemo(() => {
    const q = serviceSearch.trim();
    const filtered = services.filter(
      (s) => !selectedIds.has(s.id) && filterService(s) && serviceMatchesQuery(s, serviceSearch)
    );
    filtered.sort((a, b) => {
      if (/^\d+$/.test(q)) {
        const aId = Number(a.id);
        const bId = Number(b.id);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
      }
      const af = favoriteIds.includes(a.id) ? 1 : 0;
      const bf = favoriteIds.includes(b.id) ? 1 : 0;
      if (af !== bf) return bf - af;
      return a.name.localeCompare(b.name);
    });
    return filtered.slice(0, 80);
  }, [favoriteIds, selectedIds, pickerFilter, serviceSearch, services]);

  const totalIntended = analysis.total * selected.length;
  const ctaLabel = totalIntended > 0 ? `Place ${totalIntended.toLocaleString()} Orders` : "Place Orders";

  const estimatedTotal = useMemo(() => {
    if (analysis.total === 0 || selected.length === 0) return 0;
    let sum = 0;
    for (const row of selected) {
      const qty = Math.floor(Number(row.quantity));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      sum += (qty / 1000) * row.service.price * analysis.total;
    }
    return Math.round(sum * 10000) / 10000;
  }, [analysis.total, selected]);

  const rawCandidates = useMemo(() => (targets.match(/https?:\/\/\S+/gi) ?? []).length, [targets]);
  const ignoredTargets = Math.max(0, rawCandidates - analysis.total);

  const addService = (service: CustomerService) => {
    if (selectedIds.has(service.id)) return;
    setSelected((prev) => [...prev, { service, quantity: String(service.min) }]);
    setServiceSearch("");
    setPickerOpen(false);
    setRes(null);
    setErr(null);
  };

  const removeService = (serviceId: number) => {
    setSelected((prev) => prev.filter((row) => row.service.id !== serviceId));
    setRes(null);
    setErr(null);
  };

  const updateQuantity = (serviceId: number, value: string) => {
    setSelected((prev) => prev.map((row) => (row.service.id === serviceId ? { ...row, quantity: value } : row)));
    setRes(null);
    setErr(null);
  };

  const submit = async () => {
    if (!panelId) return;
    if (selected.length === 0) {
      setErr("Add at least one service.");
      return;
    }
    if (analysis.total === 0) {
      setErr("Paste at least one valid target link.");
      return;
    }

    const selectedServices = selected.map((row) => ({
      serviceRef: row.service.uuid ?? String(row.service.id),
      quantity: Math.floor(Number(row.quantity)),
    }));

    setBusy(true);
    setErr(null);
    setRes(null);
    const r = await runMassOrder({ panelId, targetsText: targets, selectedServices, text: "" });
    setBusy(false);

    if (!r.ok) {
      setErr(r.error);
      return;
    }

    setRes(r.data);
    if (r.data.failed === 0) {
      setTargets("");
      setSelected([]);
    }
  };

  return (
    <div className="max-w-4xl space-y-8 pb-28">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ClipboardList size={18} className="fp-gold" />
          Mass order
        </h2>
        <p className="fp-text-dim text-sm mt-1">Add services, paste targets, and place orders.</p>
      </div>

      <section className="space-y-3">
        <p className="text-sm font-medium">Add services</p>
        <div className="relative">
          {!pickerOpen ? (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-2 fp-panel-raised border fp-line-soft rounded-xl px-3.5 py-2.5 text-sm hover:fp-violet-soft-bg transition-colors"
            >
              <Plus size={14} />
              Add service
            </button>
          ) : (
            <div className="fp-panel-raised border fp-line-soft rounded-xl p-2.5">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 fp-text-faint" />
                <input
                  autoFocus
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  placeholder="Search services..."
                  className="w-full fp-panel border fp-line-soft rounded-lg pl-9 pr-10 py-2.5 text-sm outline-none focus:fp-gold-border"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen(false);
                    setServiceSearch("");
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md fp-text-faint hover:text-white hover:bg-white/5"
                  aria-label="Close service picker"
                >
                  <ChevronDown size={14} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {filterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setPickerFilter(chip.key)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      pickerFilter === chip.key
                        ? "border-[rgba(201,165,116,0.38)] text-[#EDEAE2] bg-[rgba(201,165,116,0.08)]"
                        : "border-white/10 fp-text-faint hover:text-[#EDEAE2] hover:border-white/20"
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div className="mt-2 border fp-line-soft rounded-lg divide-y fp-line-soft max-h-80 overflow-y-auto">
                {searchResults.length > 0 ? (
                  searchResults.map((s) => {
                    const isFav = favoriteIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => addService(s)}
                        className="w-full text-left px-3 py-2.5 hover:fp-violet-soft-bg transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm truncate">{s.name}</p>
                            <p className="text-[11px] fp-text-faint fp-mono truncate">
                              #{s.id} · {s.platform} / {s.category}
                            </p>
                          </div>
                          {isFav && <Star size={12} className="fp-gold shrink-0 mt-0.5" />}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-xs fp-text-faint">No services found.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-sm font-medium">Selected services</p>
        {selected.length === 0 ? (
          <div className="fp-text-faint text-sm fp-panel-raised border border-dashed border-white/15 rounded-xl px-4 py-4">
            <p>No services selected yet.</p>
            <p className="text-xs mt-1">Add a service to start a mass order.</p>
          </div>
        ) : (
          <div className="fp-panel-raised border fp-line-soft rounded-xl divide-y fp-line-soft/80">
            {selected.map((row) => {
              const qty = Math.floor(Number(row.quantity));
              const valid = Number.isFinite(qty) && qty >= row.service.min && qty <= row.service.max;
              const invalidRange = Number.isFinite(qty) && (qty < row.service.min || qty > row.service.max);
              const linePrice = Number.isFinite(qty) && qty > 0 ? (qty / 1000) * row.service.price : 0;
              return (
                <div key={row.service.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{row.service.name}</p>
                      <p className="text-[11px] fp-text-faint fp-mono mt-0.5">
                        #{row.service.id} · {row.service.platform} / {row.service.category}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeService(row.service.id)}
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md fp-text-faint hover:text-white hover:bg-white/5"
                      aria-label={`Remove ${row.service.name}`}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="text-xs fp-text-faint">Qty</label>
                    <input
                      value={row.quantity}
                      onChange={(e) => updateQuantity(row.service.id, e.target.value)}
                      inputMode="numeric"
                      className="w-28 fp-panel border fp-line-soft rounded-md px-2.5 py-1.5 text-sm outline-none focus:fp-gold-border"
                    />
                    <span className="text-xs fp-text-faint">{fmt(linePrice)} per target</span>
                    {valid && <span className="text-[11px] fp-safe">✓</span>}
                  </div>

                  <p className="text-[11px] fp-text-faint mt-2">
                    Min {row.service.min.toLocaleString()} · Max {row.service.max.toLocaleString()}
                  </p>
                  {invalidRange && (
                    <p className="text-[11px] text-amber-400 mt-1">
                      Quantity must be between {row.service.min.toLocaleString()} and {row.service.max.toLocaleString()}.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <p className="text-sm font-medium">Targets</p>
        <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 space-y-2.5">
          <p className="text-sm fp-text-dim">Paste your links or targets here.</p>
          <p className="text-[11px] fp-text-faint">
            You can paste one per line, separated by spaces/commas, or as one long pasted block.
          </p>
          <textarea
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
            rows={10}
            placeholder={"https://x.com/...\nhttps://instagram.com/..."}
            className="w-full min-h-[220px] fp-panel border fp-line-soft rounded-lg px-3.5 py-3 text-sm outline-none focus:fp-gold-border font-mono resize-y"
          />
          <div className="text-xs fp-text-faint flex flex-wrap items-center gap-2">
            <span>{analysis.total.toLocaleString()} valid targets</span>
            {ignoredTargets > 0 && <span>· {ignoredTargets.toLocaleString()} ignored</span>}
          </div>
        </div>
      </section>

      {err && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {err}
        </p>
      )}

      <section className="sticky bottom-3 z-10">
        <div className="fp-panel border fp-line rounded-xl px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[rgba(20,23,31,0.82)] bg-[rgba(20,23,31,0.95)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm">
                <span className="font-medium">{selected.length.toLocaleString()} services</span>
                <span className="fp-text-faint"> × </span>
                <span className="font-medium">{analysis.total.toLocaleString()} targets</span>
                <span className="fp-text-faint"> = </span>
                <span className="font-medium">{totalIntended.toLocaleString()} orders</span>
              </p>
              {estimatedTotal > 0 && <p className="text-xs fp-text-faint">Estimated total: {fmt(estimatedTotal)}</p>}
            </div>
            <button
              onClick={submit}
              disabled={busy || selected.length === 0 || analysis.total === 0}
              className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2 min-w-[180px]"
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Placing…
                </>
              ) : (
                ctaLabel
              )}
            </button>
          </div>
        </div>
      </section>

      {res && (
        <section className="space-y-2">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <CheckCircle2 size={13} className="fp-safe" />
            {res.totalIntended.toLocaleString()} attempted · {res.placed.toLocaleString()} successful · {res.failed.toLocaleString()} failed
          </p>
          <p className="text-xs fp-text-faint">Charged: {fmt(res.totalCharge)}</p>
          <details className="fp-panel-raised border fp-line-soft rounded-lg">
            <summary className="px-3 py-2 text-xs cursor-pointer fp-text-dim hover:text-[#EDEAE2]">View attempt details</summary>
            <div className="border-t fp-line-soft max-h-64 overflow-y-auto">
              {res.items.map((i) => (
                <p key={i.index} className={`px-3 py-1.5 text-[11px] fp-mono truncate ${i.ok ? "fp-safe" : "text-red-400/90"}`}>
                  {i.ok ? "✓" : "✕"} {i.serviceName || `#${i.serviceNo ?? i.serviceId}`} · {i.target} · Qty {i.quantity.toLocaleString()} · {i.ok ? `Order #${i.orderId}` : (i.error ?? "Failed")}
                </p>
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
