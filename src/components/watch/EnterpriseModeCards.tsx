"use client";

import React, { useState } from "react";
import { Server, KeyRound, CheckCircle2, TrendingDown } from "lucide-react";
import { SupportContactForm } from "./SupportContactForm";
import { ManagedEnterpriseCalculator } from "./ManagedEnterpriseCalculator";
import {
  ENTERPRISE_MODES, buildEnterpriseInquiryBody, WATCH_ENTERPRISE_BYO_TIERS, compareEnterpriseModesAtSlots,
  MANAGED_ENTERPRISE_50, enterpriseMediaAddon, enterprisePackageTotalWithMedia,
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
  const [managedSlots, setManagedSlots] = useState(MANAGED_ENTERPRISE_50.slots + 1);
  const [managedMediaAddon, setManagedMediaAddon] = useState(false);
  const [byoMediaAddon, setByoMediaAddon] = useState<Record<string, boolean>>({});
  const comparison = compareEnterpriseModesAtSlots(MANAGED_ENTERPRISE_50.slots); // the one real, equivalent-capacity point (BYO 50's own tier)
  // Which Media Moderation + package (if any) is currently checked, keyed to
  // the SAME addon-key shape enterpriseMediaAddon/buildEnterpriseInquiryBody
  // use -- feeds the actual submitted inquiry, closing the gap where
  // checking the box only ever changed the DISPLAYED price, never the
  // request itself.
  const activeMediaAddonKey: "managed50" | "byo50" | "byoUnlimited" | undefined =
    mode === "managed"
      ? (managedMediaAddon ? "managed50" : undefined)
      : (Object.entries(byoMediaAddon).find(([, on]) => on)?.[0] === "byo_50" ? "byo50" : byoMediaAddon.byo_unlimited ? "byoUnlimited" : undefined);

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
                <p className="text-xs w-text-dim">Innvil manages and pays for your Watchers' conversational provider — ${MANAGED_ENTERPRISE_50.price.toFixed(2)}/mo for {MANAGED_ENTERPRISE_50.slots} slots.</p>
              ) : (
                <p className="text-xs w-text-dim">Your own supported provider credentials — from ${WATCH_ENTERPRISE_BYO_TIERS[0].price}/mo. Lower Innvil platform fee; provider usage is paid separately.</p>
              )}
            </button>
          );
        })}
      </div>

      {mode === "managed" ? (
        <div className="mb-5">
          <div className="w-surface-raised border w-teal-border rounded-lg p-4 mb-3">
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Managed Enterprise 50</p>
            <p className="w-display text-xl w-teal mb-1">
              ${(managedMediaAddon ? enterprisePackageTotalWithMedia(MANAGED_ENTERPRISE_50.price, "managed50") : MANAGED_ENTERPRISE_50.price).toFixed(2)}
              <span className="text-xs w-text-faint font-normal">/mo</span>
            </p>
            <p className="text-xs w-text-dim">{MANAGED_ENTERPRISE_50.slots} Watcher slots · {MANAGED_ENTERPRISE_50.communities} Communities included · {MANAGED_ENTERPRISE_50.aiGenerations.toLocaleString()} pooled AI Generations/mo</p>
            <label className="flex items-center gap-2 mt-2.5 text-xs w-text-dim cursor-pointer">
              <input type="checkbox" checked={managedMediaAddon} onChange={(e) => setManagedMediaAddon(e.target.checked)} />
              Media Moderation + (+${enterpriseMediaAddon("managed50").price.toFixed(2)}/mo, {enterpriseMediaAddon("managed50").units.toLocaleString()} Media Moderation Units/mo)
            </label>
          </div>
          <p className="text-xs w-text-faint mb-2">Need more than {MANAGED_ENTERPRISE_50.slots} Watcher slots?</p>
          <ManagedEnterpriseCalculator slots={managedSlots} onSlotsChange={setManagedSlots} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {WATCH_ENTERPRISE_BYO_TIERS.map((tier) => {
            const addonKey = tier.id === "byo_50" ? "byo50" : "byoUnlimited";
            const addon = enterpriseMediaAddon(addonKey);
            const enabled = !!byoMediaAddon[tier.id];
            return (
              <div key={tier.id} className="w-surface-raised border w-line-soft rounded-lg p-4">
                <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">{tier.label}</p>
                <p className="w-display text-xl w-teal mb-1">
                  ${(enabled ? enterprisePackageTotalWithMedia(tier.price, addonKey) : tier.price).toFixed(2)}
                  <span className="text-xs w-text-faint font-normal">/mo</span>
                </p>
                <p className="text-xs w-text-dim">{tier.maxSlots ? `Up to ${tier.maxSlots} licensed Watcher deployments` : "Unlimited licensed Watcher deployments"}</p>
                <p className="text-[11px] w-text-faint mt-1.5">Community capacity: Custom</p>
                <label className="flex items-center gap-2 mt-2.5 text-xs w-text-dim cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setByoMediaAddon((prev) => ({ ...prev, [tier.id]: e.target.checked }))}
                  />
                  Media Moderation + (+${addon.price.toFixed(2)}/mo, {addon.units.toLocaleString()} Media Moderation Units/mo)
                </label>
              </div>
            );
          })}
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
        {/* key stays scoped to `mode` only (not `managedSlots`) -- SupportContactForm
            seeds its body from `defaultBody` ONCE at mount and is freely editable
            afterward; remounting on every slot-slider tweak would silently wipe
            anything the customer had already typed. The pre-filled body reflects
            whatever slot count was selected the moment Managed mode was entered --
            the visible calculator numbers stay live regardless, and the message
            itself is always editable before sending. */}
        <SupportContactForm
          key={`${mode}-${activeMediaAddonKey ?? "none"}`}
          defaultSubject={ENTERPRISE_MODES[mode].inquirySubject}
          defaultBody={buildEnterpriseInquiryBody(mode, baseBody, mode === "managed" ? managedSlots : undefined, activeMediaAddonKey)}
        />
      </div>
    </div>
  );
}
