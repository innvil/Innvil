"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Search, Star, Lock, CheckCircle2, XCircle, Link2, Hash, Droplets, ChevronDown,
} from "lucide-react";
import { Toggle } from "@/src/components/ui";
import {
  PLATFORMS, PlatformKey, CustomerService, customerServices,
} from "@/src/data/constants";
import { PlatformButton } from "./PlatformIcons";
import { formatMoney } from "@/src/lib/money";
import { validateOrderLink } from "@/src/lib/order-link";

/** Real order placement — resolves with success or an error message. */
export interface PlaceOrderArgs {
  service: CustomerService;
  quantity: number;
  total: string;
  link: string;
  runs?: number;
  interval?: number;
  /** Custom Comments services: the list of comments (one per line). */
  comments?: string;
}
export type PlaceOrderHandler = (args: PlaceOrderArgs) => Promise<{ ok: boolean; error?: string }>;

/** Per-platform display overrides (label + custom monochrome logo path). */
export type PlatformMeta = Record<string, { label?: string; icon?: string | null }>;

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** Nicer default labels for platforms that ship a built-in glyph but aren't in PLATFORMS. */
const EXTRA_LABELS: Record<string, string> = { linkedin: "LinkedIn", bluesky: "Bluesky" };

/* =========================================================
   SMART SEARCH
   Matches platform (incl. aliases like "twitter" → X),
   category, service name, service ID, and service aliases.
   ========================================================= */

function matchesQuery(s: CustomerService, query: string): boolean {
  const platform = PLATFORMS.find((p) => p.key === s.platform);
  const haystack = [
    s.name,
    s.category,
    String(s.id),
    platform?.label ?? "",
    ...(platform?.aliases ?? []),
    ...s.aliases,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function matchesNumericId(id: number, numericQuery: string): boolean {
  const sid = String(id);
  // Numeric search is ID-only to prevent matches from text fields (e.g. "20 days").
  return sid.startsWith(numericQuery);
}

const FAVORITES_CATEGORY = "★ Favorites";

/* =========================================================
   NEW ORDER — progressive form
   Platform → Search → Category → Service → Link → Qty → Amount
   Category disabled until platform; service until category.
   Changing platform resets everything below it.
   ========================================================= */

export function NewOrder({
  canOrder,
  favoriteIds,
  onToggleFavorite,
  prefillServiceId,
  onOrderPlaced,
  services = customerServices,
  onPlaceOrder,
  platformMeta,
  currency = "USD",
}: {
  canOrder: boolean;
  favoriteIds: number[];
  onToggleFavorite: (id: number) => void;
  prefillServiceId?: number | null;
  onOrderPlaced?: (service: CustomerService, qty: number, total: string) => void;
  /** Live catalog to order from (defaults to mock data for the preview). */
  services?: CustomerService[];
  /** When provided, orders are placed for real via this async handler. */
  onPlaceOrder?: PlaceOrderHandler;
  /** Per-platform label/logo overrides (for owner-added platforms). */
  platformMeta?: PlatformMeta;
  /** Panel operating currency (ISO code) for price display. */
  currency?: string;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const [platform, setPlatform] = useState<PlatformKey | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [service, setService] = useState<CustomerService | null>(null);
  const [query, setQuery] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [link, setLink] = useState("");
  const [qty, setQty] = useState<string>("");
  const [placed, setPlaced] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  // Once a service is chosen the list collapses into a re-pick dropdown.
  const [pickerOpen, setPickerOpen] = useState(true);

  // Resolve a platform's display label / custom logo path.
  const labelFor = (key: string) =>
    platformMeta?.[key]?.label ?? PLATFORMS.find((p) => p.key === key)?.label ?? EXTRA_LABELS[key] ?? cap(key);
  const pathFor = (key: string) => platformMeta?.[key]?.icon ?? undefined;

  // Only platforms that actually have services show up (auto-hide empties),
  // in the canonical order first, then any owner-added platforms after.
  const availablePlatforms = useMemo(() => {
    const order = PLATFORMS.map((p) => p.key) as string[];
    const keys = [...new Set(services.map((s) => s.platform as string))].filter(Boolean);
    keys.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ key: k, label: labelFor(k), path: pathFor(k) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, platformMeta]);
  // Drip feed is always OFF by default — customer opts in per order
  const [drip, setDrip] = useState(false);
  const [dripRuns, setDripRuns] = useState("5");
  const [dripInterval, setDripInterval] = useState("30");
  const [comments, setComments] = useState("");

  const selectService = (s: CustomerService) => {
    setPlatform(s.platform);
    setCategory(s.category);
    setService(s);
    setQty(String(s.min));
    setQuery("");
    setPlaced(false);
    setPlaceError(null);
    setDrip(false);
    setComments("");
    setServiceSearch("");
    setPickerOpen(false); // collapse the list to a dropdown once chosen
  };

  // Prefill from Quick Order / Reorder — one click to a ready form
  useEffect(() => {
    if (prefillServiceId != null) {
      const s = services.find((x) => x.id === prefillServiceId);
      if (s) selectService(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillServiceId]);

  // Synchronous, in-memory filtering — results render on the same keystroke.
  // Never debounce or defer the input echo (see input-responsiveness rule).
  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    if (/^\d+$/.test(q)) {
      const matches = services.filter((s) => matchesNumericId(s.id, q));
      matches.sort((a, b) => {
        const aId = Number(a.id);
        const bId = Number(b.id);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
        return a.name.localeCompare(b.name);
      });
      return matches.slice(0, 8);
    }

    const matches = services.filter((s) => matchesQuery(s, q));
    return matches.slice(0, 8);
  }, [query, services]);

  const platformFavorites = useMemo(
    () =>
      services.filter(
        (s) => s.platform === platform && favoriteIds.includes(s.id)
      ),
    [platform, favoriteIds, services]
  );

  const categories = useMemo(() => {
    if (!platform) return [];
    const cats = [...new Set(
      services.filter((s) => s.platform === platform).map((s) => s.category)
    )];
    return platformFavorites.length > 0 ? [FAVORITES_CATEGORY, ...cats] : cats;
  }, [platform, platformFavorites, services]);

  const servicesInCategory = useMemo(() => {
    if (!platform || !category) return [];
    if (category === FAVORITES_CATEGORY) return platformFavorites;
    return services.filter(
      (s) => s.platform === platform && s.category === category
    );
  }, [platform, category, platformFavorites, services]);

  const filteredServicesInCategory = useMemo(() => {
    const q = serviceSearch.trim();
    if (!q) return servicesInCategory;
    if (/^\d+$/.test(q)) {
      const matches = servicesInCategory.filter((s) => matchesNumericId(s.id, q));
      matches.sort((a, b) => {
        const aId = Number(a.id);
        const bId = Number(b.id);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
        return a.name.localeCompare(b.name);
      });
      return matches;
    }

    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = servicesInCategory.filter((s) => {
      const hay = [s.name, s.category, String(s.id), ...s.aliases].join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    return matches;
  }, [serviceSearch, servicesInCategory]);

  const isComments = !!service?.comments;
  const commentLines = useMemo(
    () => comments.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [comments]
  );
  const qtyNum = isComments ? commentLines.length : (parseInt(qty, 10) || 0);
  const qtyValid = service ? qtyNum >= service.min && qtyNum <= service.max : false;
  const total = service && qtyNum > 0 ? money((qtyNum / 1000) * service.price) : money(0);
  const isFavorite = service ? favoriteIds.includes(service.id) : false;

  const handlePlatform = (key: PlatformKey) => {
    // Reset dependent selections to prevent invalid orders
    setPlatform(key);
    setCategory(null);
    setService(null);
    setLink("");
    setQty("");
    setPlaced(false);
    setDrip(false);
    setServiceSearch("");
    setPickerOpen(true);
  };

  // Real orders require a link; the preview (onOrderPlaced only) does not.
  const linkRequired = !!onPlaceOrder;
  const canSubmit = qtyValid && (!linkRequired || link.trim().length > 0);

  const handleCreate = async () => {
    if (!service || !canSubmit || !canOrder || placing) return;
    setPlaceError(null);
    if (onPlaceOrder) {
      const linkCheck = validateOrderLink(link);
      if (!linkCheck.ok) {
        setPlaceError(linkCheck.error);
        return;
      }
      setPlacing(true);
      const res = await onPlaceOrder({
        service,
        quantity: qtyNum,
        total,
        link: linkCheck.url,
        runs: drip ? Number(dripRuns) || undefined : undefined,
        interval: drip ? Number(dripInterval) || undefined : undefined,
        comments: isComments ? comments : undefined,
      });
      setPlacing(false);
      if (!res.ok) { setPlaceError(res.error ?? "Could not place the order."); return; }
      setPlaced(true);
    } else {
      setPlaced(true);
      onOrderPlaced?.(service, qtyNum, total);
    }
  };

  const inputCls =
    "w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2] disabled:opacity-40";

  return (
    <div className="grid lg:grid-cols-5 gap-6 items-start">
      <div className="lg:col-span-3 space-y-5">
        {!canOrder && (
          <div className="fp-panel border border-[rgba(201,165,116,0.3)] rounded-2xl p-4 flex items-center gap-3">
            <Lock size={16} className="fp-gold shrink-0" />
            <div>
              <p className="text-sm fp-gold font-medium">Orders temporarily paused</p>
              <p className="text-xs fp-text-dim mt-0.5">
                You can still browse services, add funds, and view your history.
              </p>
            </div>
          </div>
        )}

        {/* 1. Platform — icon buttons, one row desktop / scroll mobile.
            Only platforms with services show; owner-added ones use custom logos. */}
        <div className="fp-panel border fp-line rounded-2xl p-5">
          <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-4">Platform</p>
          {availablePlatforms.length === 0 ? (
            <p className="text-sm fp-text-faint">No services available yet.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
              {availablePlatforms.map((p) => (
                <PlatformButton
                  key={p.key}
                  platform={p.key}
                  label={p.label}
                  pathOverride={p.path}
                  active={platform === p.key}
                  onClick={() => handlePlatform(p.key as PlatformKey)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 2. Smart search — jumps straight to a service */}
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 fp-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search anything — try "twitter views" or a service ID'
            className={`${inputCls} pl-10 py-3`}
          />
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-[#151922] border border-[#2A3040] rounded-xl shadow-[0_18px_40px_rgba(0,0,0,0.55)] z-30 overflow-hidden backdrop-blur-0">
              {searchResults.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectService(s)}
                  className="w-full text-left px-4 py-3 hover:fp-violet-soft-bg transition-colors border-b fp-line-soft last:border-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate">{s.name}</p>
                    <p className="text-xs fp-text-faint fp-mono mt-0.5">
                      #{s.id} · {labelFor(s.platform)} · {s.category}
                    </p>
                  </div>
                  <span className="fp-mono text-xs fp-gold shrink-0">
                    {money(s.price)}/{s.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
          {query.trim() && searchResults.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-[#151922] border border-[#2A3040] rounded-xl shadow-[0_18px_40px_rgba(0,0,0,0.55)] z-30 px-4 py-4 text-sm fp-text-dim">
              No services match &quot;{query}&quot;. Try a platform name, category, or service ID.
            </div>
          )}
        </div>

        {/* 3. Category — disabled until platform selected */}
        <div className={`fp-panel border fp-line rounded-2xl p-5 ${!platform ? "opacity-50" : ""}`}>
          <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-4">Category</p>
          {!platform ? (
            <p className="text-sm fp-text-faint">Select a platform to see its categories.</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => { setCategory(c); setService(null); setQty(""); setPlaced(false); }}
                  className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
                    category === c
                      ? "fp-violet-soft-bg fp-violet border-[rgba(139,127,255,0.45)]"
                      : "fp-panel-raised fp-text-dim border-[#262A35] hover:fp-text"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 4. Service — disabled until category selected */}
        <div className={`fp-panel border fp-line rounded-2xl p-5 ${!category ? "opacity-50" : ""}`}>
          <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-4">Service</p>
          {!category ? (
            <p className="text-sm fp-text-faint">Select a category to see available services.</p>
          ) : service && !pickerOpen ? (
            // Collapsed: show the chosen service as a dropdown you can reopen.
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full text-left rounded-xl border border-[rgba(139,127,255,0.45)] bg-[rgba(139,127,255,0.08)] px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{service.name}</p>
                <p className="text-xs fp-text-faint fp-mono mt-0.5">
                  #{service.id} · tap to choose another in {category}
                </p>
              </div>
              <span className="flex items-center gap-2 shrink-0">
                <span className="fp-mono text-sm fp-gold">{money(service.price)}/{service.unit}</span>
                <ChevronDown size={16} className="fp-text-faint" />
              </span>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 fp-text-faint" />
                <input
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  placeholder="Search services in this category"
                  className={`${inputCls} pl-9`}
                />
              </div>
              {filteredServicesInCategory.length === 0 ? (
                <p className="text-sm fp-text-faint py-3 px-1">
                  No services match &quot;{serviceSearch}&quot; in this category.
                </p>
              ) : filteredServicesInCategory.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectService(s)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-colors flex items-center justify-between gap-3 ${
                    service?.id === s.id
                      ? "border-[rgba(139,127,255,0.45)] bg-[rgba(139,127,255,0.08)]"
                      : "border-[#1E212A] bg-[#1B1E27] hover:border-[#3A3F4E]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-xs fp-text-faint fp-mono mt-0.5">
                      #{s.id} · min {s.min.toLocaleString()} · max {s.max.toLocaleString()}
                    </p>
                  </div>
                  <span className="fp-mono text-sm fp-gold shrink-0">
                    {money(s.price)}/{s.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 5–6. Link + quantity — number input, never a slider */}
        {service && (
          <div className="fp-panel border fp-line rounded-2xl p-5 space-y-4">
            <div>
              <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Link2 size={11} /> Link
              </p>
              <input
                disabled={!canOrder}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://instagram.com/yourprofile"
                className={inputCls}
              />
            </div>
            {isComments ? (
              <div>
                <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Hash size={11} /> Comments — one per line
                </p>
                <textarea
                  disabled={!canOrder}
                  value={comments}
                  onChange={(e) => { setComments(e.target.value); setPlaced(false); }}
                  rows={6}
                  placeholder={"Great post!\nLove this 🔥\nAmazing content"}
                  className={`${inputCls} resize-y`}
                />
                <p className={`text-xs mt-1.5 ${qtyValid || commentLines.length === 0 ? "fp-text-faint" : "text-red-400"}`}>
                  {commentLines.length} comment{commentLines.length === 1 ? "" : "s"} · {service.min.toLocaleString()}–{service.max.toLocaleString()} allowed
                </p>
              </div>
            ) : (
            <div>
              <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Hash size={11} /> Quantity
              </p>
              <input
                disabled={!canOrder}
                type="number"
                inputMode="numeric"
                min={service.min}
                max={service.max}
                value={qty}
                onChange={(e) => { setQty(e.target.value); setPlaced(false); }}
                placeholder={`${service.min.toLocaleString()} – ${service.max.toLocaleString()}`}
                className={`${inputCls} fp-mono`}
              />
              {qty !== "" && !qtyValid && (
                <p className="text-xs text-red-400 mt-1.5">
                  Quantity must be between {service.min.toLocaleString()} and {service.max.toLocaleString()}.
                </p>
              )}
            </div>
            )}

            {/* Drip feed — only for services that support it, off by default */}
            {service.drip && (
              <div className="border-t fp-line-soft pt-4">
                <button
                  onClick={() => canOrder && setDrip(!drip)}
                  disabled={!canOrder}
                  aria-pressed={drip}
                  className="w-full flex items-center justify-between gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-left">
                    <span className="fp-text-faint text-xs fp-mono uppercase tracking-wide flex items-center gap-1.5">
                      <Droplets size={11} /> Drip feed
                    </span>
                    <span className="text-xs fp-text-dim block mt-1">
                      Spread delivery into smaller runs over time.
                    </span>
                  </span>
                  <Toggle on={drip} />
                </button>
                {drip && (
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div>
                      <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-2">Runs</p>
                      <input
                        disabled={!canOrder}
                        type="number"
                        inputMode="numeric"
                        min={2}
                        value={dripRuns}
                        onChange={(e) => setDripRuns(e.target.value)}
                        className={`${inputCls} fp-mono`}
                      />
                    </div>
                    <div>
                      <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-2">Interval (min)</p>
                      <input
                        disabled={!canOrder}
                        type="number"
                        inputMode="numeric"
                        min={5}
                        value={dripInterval}
                        onChange={(e) => setDripInterval(e.target.value)}
                        className={`${inputCls} fp-mono`}
                      />
                    </div>
                    <p className="col-span-2 text-xs fp-text-dim">
                      Total quantity stays {qtyNum > 0 ? qtyNum.toLocaleString() : "the same"} — it&apos;s
                      split across {dripRuns || "—"} runs, one every {dripInterval || "—"} minutes.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky order summary + service preview (desktop) */}
      <div className="lg:col-span-2 lg:sticky lg:top-20 space-y-5">
        {service ? (
          <>
            <div className="fp-panel border fp-line rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide">Service preview</p>
                  <p className="fp-display text-lg mt-1 leading-snug">{service.name}</p>
                </div>
                <button
                  onClick={() => onToggleFavorite(service.id)}
                  className={`shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${
                    isFavorite
                      ? "fp-gold-soft-bg fp-gold border-[rgba(201,165,116,0.35)]"
                      : "fp-panel-raised fp-text-faint border-[#262A35] hover:fp-gold"
                  }`}
                  title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star size={15} fill={isFavorite ? "currentColor" : "none"} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <span className="fp-text-faint text-xs fp-mono">ID</span>
                <span className="fp-mono text-xs text-right">#{service.id}</span>
                <span className="fp-text-faint text-xs fp-mono">Min / Max</span>
                <span className="fp-mono text-xs text-right">
                  {service.min.toLocaleString()} / {service.max.toLocaleString()}
                </span>
                <span className="fp-text-faint text-xs fp-mono">Start time</span>
                <span className="fp-mono text-xs text-right">{service.startTime}</span>
                <span className="fp-text-faint text-xs fp-mono">Completion</span>
                <span className="fp-mono text-xs text-right">{service.completion}</span>
                <span className="fp-text-faint text-xs fp-mono">Refill</span>
                <span className={`text-xs text-right flex items-center justify-end gap-1 ${service.refill ? "fp-safe" : "fp-text-faint"}`}>
                  {service.refill ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {service.refill ? "Available" : "Not available"}
                </span>
                <span className="fp-text-faint text-xs fp-mono">Cancel</span>
                <span className={`text-xs text-right flex items-center justify-end gap-1 ${service.cancel ? "fp-safe" : "fp-text-faint"}`}>
                  {service.cancel ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {service.cancel ? "Available" : "Not available"}
                </span>
                <span className="fp-text-faint text-xs fp-mono">Drip feed</span>
                <span className={`text-xs text-right flex items-center justify-end gap-1 ${service.drip ? "fp-safe" : "fp-text-faint"}`}>
                  {service.drip ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {service.drip ? "Available" : "Not available"}
                </span>
              </div>
              <p className="text-xs fp-text-dim mt-4 pt-4 border-t fp-line-soft leading-relaxed">
                {service.description}
              </p>
            </div>

            <div className="fp-panel border fp-gold-border rounded-2xl p-5">
              <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-4">Order summary</p>
              <div className="flex justify-between text-sm mb-2">
                <span className="fp-text-dim truncate mr-3">{service.name}</span>
                <span className="fp-mono shrink-0">{qtyNum > 0 ? qtyNum.toLocaleString() : "—"}</span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="fp-text-dim">Rate</span>
                <span className="fp-mono">{money(service.price)} / {service.unit}</span>
              </div>
              {drip && (
                <div className="flex justify-between text-sm mb-2">
                  <span className="fp-text-dim flex items-center gap-1.5">
                    <Droplets size={12} className="fp-violet" /> Drip feed
                  </span>
                  <span className="fp-mono">
                    {dripRuns || "—"} runs · every {dripInterval || "—"} min
                  </span>
                </div>
              )}
              <div className="border-t fp-line-soft pt-4 mt-4 flex justify-between items-end">
                <span className="fp-display text-lg">Total</span>
                <span className="fp-display text-3xl fp-gold">{total}</span>
              </div>
              <button
                disabled={!canOrder || !canSubmit || placed || placing}
                onClick={handleCreate}
                className="fp-btn-primary font-semibold w-full py-3 rounded-lg mt-5 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                {placed
                  ? "Order placed ✓"
                  : placing
                    ? "Placing order…"
                    : !canOrder
                      ? "Orders temporarily paused"
                      : linkRequired && !link.trim()
                        ? "Enter a link to continue"
                        : `Create order — ${total}`}
              </button>
              {placeError && (
                <p className="text-xs text-red-400 text-center mt-3 flex items-center justify-center gap-1">
                  <XCircle size={12} /> {placeError}
                </p>
              )}
              {placed && (
                <p className="text-xs fp-safe text-center mt-3 flex items-center justify-center gap-1">
                  <CheckCircle2 size={12} /> Order submitted. Track it under Orders.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="fp-panel border fp-line rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-2xl fp-violet-soft-bg fp-violet flex items-center justify-center mx-auto mb-4">
              <Search size={22} />
            </div>
            <p className="fp-display text-lg mb-2">Pick a platform to start</p>
            <p className="text-sm fp-text-dim leading-relaxed">
              Or use search to jump straight to a service — it understands aliases,
              categories, and service IDs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
