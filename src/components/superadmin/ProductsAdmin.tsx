"use client";

import React, { useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import { listProducts, createProduct, setProductStatus, updateProduct } from "@/src/lib/actions/products";
import { PRODUCT_STATUSES, type ProductRow, type ProductStatus } from "@/src/lib/products/catalog";

/**
 * Superadmin-only official Product Catalog management (Innvil Forge /
 * Innvil Watch / Innvil Herald / future products) — Phase 1 of the
 * multi-product architecture. Deliberately minimal: list + add + lifecycle
 * status change + a couple of metadata fields, per the explicit "do not
 * overbuild advanced merchandising" instruction. Every action re-verifies
 * superadmin server-side (products.ts); this UI is convenience only.
 */
export function ProductsAdmin() {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", description: "", domain: "" });

  const refresh = React.useCallback(async () => {
    setProducts(await listProducts());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    setBusy("add"); setMsg(null);
    const res = await createProduct({
      slug: form.slug,
      name: form.name,
      description: form.description || null,
      domain: form.domain || null,
    });
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setForm({ slug: "", name: "", description: "", domain: "" });
    setShowAdd(false);
    setMsg({ text: `Created ${res.data.name}.` });
    await refresh();
  };

  const changeStatus = async (id: string, status: ProductStatus) => {
    setBusy(id); setMsg(null);
    const res = await setProductStatus(id, status);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    await refresh();
  };

  const toggleFlag = async (id: string, key: "standaloneAvailable" | "crossSellAvailable", value: boolean) => {
    setBusy(id); setMsg(null);
    const res = await updateProduct(id, { [key]: value });
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    await refresh();
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Boxes size={18} className="fp-gold" />
          <h2 className="text-sm font-semibold fp-text">Official Innvil Products</h2>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="text-xs px-2.5 py-1 rounded-lg border fp-line-soft fp-panel-raised fp-text-dim hover:fp-text">
          {showAdd ? "Cancel" : "Add product"}
        </button>
      </div>

      <p className="text-xs fp-text-faint mb-4">
        The catalog of Innvil&apos;s own official software products (Forge, Watch, Herald, and future products) — separate from any panel
        owner&apos;s own SMM service catalog. Superadmin-only.
      </p>

      {showAdd && (
        <div className="fp-panel-raised border fp-line-soft rounded-lg p-3 mb-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="slug (e.g. herald)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border" />
            <input placeholder="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border" />
          </div>
          <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border" />
          <input placeholder="Domain (optional, e.g. herald.innvil.cloud)" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}
            className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border" />
          <button onClick={add} disabled={busy === "add" || !form.slug.trim() || !form.name.trim()} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60">
            {busy === "add" ? "Creating…" : "Create product"}
          </button>
        </div>
      )}

      {msg && <p className={`text-xs mb-3 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</p>}

      <div className="space-y-2">
        {products === null ? (
          <p className="text-xs fp-text-faint">Loading&hellip;</p>
        ) : products.length === 0 ? (
          <p className="text-xs fp-text-faint">No products yet.</p>
        ) : products.map((p) => (
          <div key={p.id} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm fp-text font-medium">{p.name} <span className="text-[11px] fp-text-faint fp-mono">({p.slug})</span></p>
                {p.description && <p className="text-[11px] fp-text-faint mt-0.5">{p.description}</p>}
                {p.domain && <p className="text-[11px] fp-text-faint fp-mono mt-0.5">{p.domain}</p>}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={p.status}
                  onChange={(e) => changeStatus(p.id, e.target.value as ProductStatus)}
                  disabled={busy === p.id}
                  className="text-[11px] fp-panel-raised border fp-line-soft rounded-lg px-2 py-1 fp-text-dim outline-none focus:fp-gold-border disabled:opacity-60"
                >
                  {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[11px] fp-text-faint">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={p.standaloneAvailable} disabled={busy === p.id}
                  onChange={(e) => toggleFlag(p.id, "standaloneAvailable", e.target.checked)} />
                Standalone
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={p.crossSellAvailable} disabled={busy === p.id}
                  onChange={(e) => toggleFlag(p.id, "crossSellAvailable", e.target.checked)} />
                Cross-sell
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
