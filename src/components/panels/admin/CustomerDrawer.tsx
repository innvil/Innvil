"use client";

import React from "react";
import { X, UserCircle2, Copy } from "lucide-react";
import { customerProfileExtra } from "@/src/data/constants";
import { CustomerRow } from "@/src/types";

/** Panel-owner-side customer profile drawer. */
export function CustomerDrawer({
  customer,
  onClose,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
}) {
  if (!customer) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="fp-panel border fp-line rounded-2xl w-full max-w-lg p-6 relative max-h-[85vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 fp-text-faint hover:fp-text">
          <X size={18} />
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full fp-violet-soft-bg flex items-center justify-center">
            <UserCircle2 size={20} className="fp-violet" />
          </div>
          <div>
            <p className="fp-display text-lg">{customer.handle}</p>
            <p className="fp-text-faint text-xs">Joined {customer.joined}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="fp-panel-raised border fp-line-soft rounded-lg p-3">
            <p className="fp-text-faint text-xs fp-mono uppercase">Wallet balance</p>
            <p className="fp-display text-lg mt-1">{customerProfileExtra.wallet}</p>
          </div>
          <div className="fp-panel-raised border fp-line-soft rounded-lg p-3">
            <p className="fp-text-faint text-xs fp-mono uppercase">Total spent</p>
            <p className="fp-display text-lg mt-1">{customer.spent}</p>
          </div>
        </div>
        {[
          { t: "Deposit history", items: customerProfileExtra.deposits },
          { t: "Order history", items: [`${customer.orders} orders total — most recent: Instagram Followers, 5,000`] },
          { t: "Support tickets", items: ["1 open ticket — 'Order stuck on processing'"] },
          { t: "Login history", items: customerProfileExtra.logins },
          { t: "Referral info", items: [customerProfileExtra.referral] },
        ].map((s) => (
          <div key={s.t} className="mb-4">
            <p className="fp-text-faint text-xs fp-mono uppercase mb-2">{s.t}</p>
            {s.items.map((i) => <p key={i} className="text-sm fp-text-dim">{i}</p>)}
          </div>
        ))}
        <div className="mb-5">
          <p className="fp-text-faint text-xs fp-mono uppercase mb-2">API key</p>
          <div className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 fp-mono text-xs flex items-center justify-between">
            {customerProfileExtra.apiKey} <Copy size={12} className="cursor-pointer" />
          </div>
        </div>
        <div className="mb-5">
          <label className="fp-text-dim text-xs fp-mono uppercase">Internal notes</label>
          <textarea rows={2} placeholder="Visible to panel staff only" className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm mt-2 outline-none focus:fp-violet-border" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim">Adjust balance</button>
          <button className="fp-panel-raised border fp-line-soft text-xs px-3 py-2 rounded-lg fp-text-dim">Restrict ordering</button>
          <button className="fp-panel-raised border border-red-500/30 text-xs px-3 py-2 rounded-lg text-red-400">Ban customer</button>
        </div>
      </div>
    </div>
  );
}
