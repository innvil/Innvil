"use client";

import React, { useState } from "react";
import { Server, KeyRound, CheckCircle2, TrendingDown } from "lucide-react";
import { SupportContactForm } from "./SupportContactForm";
import { ManagedEnterpriseCalculator } from "./ManagedEnterpriseCalculator";
import {
  ENTERPRISE_MODES, buildEnterpriseInquiryBody, WATCH_ENTERPRISE_BYO_TIERS, compareEnterpriseModesAtSlots,
  type EnterpriseMode,
} from "@/src/lib/products/watch-enterprise";

const MODE_ICON: Record<EnterpriseMode, typeof Server> = { managed: Server, byo: KeyRound };

/** Two related, commercially concrete Enterprise modes under the SAME
 *  Innvil Watch product — not separate products, domains, or CRMs (see
 *  CLAUDE.md). Managed pricing is a live formula; BYO pricing is the fixed
 *  two-tier model. Selecting a mode only changes which pre-filled subject/
 *  context the SAME existing `sendOwnerSupportMessage` inquiry channel uses
 *  (remounted via `key` on mode change). No fake "Connect Provider" flow —
 *  BYO has no real credentials backend yet, so it's inquiry-only, same as
 *  Managed. */
export function EnterpriseModeCards({ baseBody }: { baseBody: string }) {
  const [mode, setMode] = useState<EnterpriseMode>("managed");
  const comparison = compareEnterpriseModesAtSlots(50); // the one real, equivalent-capacity point (BYO 50's own tier)

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {(Object.keys(ENTERPRISE_MODES) as EnterpriseMode[]).map((m) => {
          const meta = ENTERPRISE_MODES[m];
          const Icon = MODE_ICON[m];
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={active}
              className={`text-left w-surface-raised border rounded-lg p-4 transition-colors ${active ? "w-teal-border" : "w-line-soft hover:w-teal-border"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2">
                  <Icon size={15} className="w-teal" />
                  <span className="w-display text-sm w-text">{meta.label}</span>
                </span>
                {active && <CheckCircle2 size={15} className="w-teal shrink-0" />}
              </div>
              <p className="text-xs w-text-faint mb-2">{meta.tagline}</p>
              {m === "managed" ? (
                <p className="text-xs w-text-dim">Innvil supplies and manages the supported provider capacity for your Watchers — starting from $379.99/mo.</p>
              ) : (
                <p className="text-xs w-text-dim">Your own supported provider credentials — from $599/mo, provider usage billed directly through your own account.</p>
              )}
            </button>
          );
        })}
      </div>

      {mode === "managed" ? (
        <div className="mb-5">
          <ManagedEnterpriseCalculator />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {WATCH_ENTERPRISE_BYO_TIERS.map((tier) => (
            <div key={tier.id} className="w-surface-raised border w-line-soft rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">{tier.label}</p>
              <p className="w-display text-xl w-teal mb-1">${tier.price}<span className="text-xs w-text-faint font-normal">/mo</span></p>
              <p className="text-xs w-text-dim">{tier.maxSlots ? `Up to ${tier.maxSlots} licensed Watcher deployments` : "Unlimited licensed Watcher deployments"}</p>
              <p className="text-[11px] w-text-faint mt-1.5">Community capacity: Custom</p>
            </div>
          ))}
        </div>
      )}

      {mode === "byo" && comparison && (
        <div className="w-surface-raised border w-teal-border rounded-lg p-3 text-xs w-text-dim mb-5">
          <p className="w-text font-semibold mb-1.5 flex items-center gap-1.5"><TrendingDown size={14} className="w-teal" /> At equivalent 50-slot capacity</p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div><p className="w-text-faint text-[10px] uppercase">Managed</p><p className="w-text font-medium">${comparison.managedPrice.toFixed(2)}/mo</p></div>
            <div><p className="w-text-faint text-[10px] uppercase">BYO 50</p><p className="w-text font-medium">${comparison.byoPrice}/mo</p></div>
            <div><p className="w-text-faint text-[10px] uppercase">Innvil-fee savings</p><p className="w-teal font-semibold">${comparison.savingsAmount.toFixed(2)} ({comparison.savingsPercent}%)</p></div>
          </div>
          <p>This compares only the Innvil platform fee at the same 50-slot capacity. It doesn't include your own provider usage cost, which is billed directly through your provider account — so it isn't a guarantee your total spend is lower.</p>
        </div>
      )}

      <div className="max-w-md">
        <SupportContactForm key={mode} defaultSubject={ENTERPRISE_MODES[mode].inquirySubject} defaultBody={buildEnterpriseInquiryBody(mode, baseBody)} />
      </div>
    </div>
  );
}
