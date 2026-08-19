"use client";

import React, { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

/** Accessible click/tap/keyboard-toggleable info popover — the shared
 *  primitive behind both the Watcher-slot explanation and the Community
 *  max-capacity explanation on Billing's plan cards. Deliberately NOT
 *  hover-only (hover alone doesn't serve touch or keyboard users). Opens on
 *  click/Enter/Space, closes on Escape or an outside click, and is labeled
 *  so a screen reader announces its purpose. */
export function InfoPopover({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        className="w-text-faint hover:w-teal inline-flex items-center"
      >
        <Info size={13} />
      </button>
      {open && (
        <div role="tooltip" className="absolute z-20 top-5 left-1/2 -translate-x-1/2 w-56 w-card-raised border w-teal-border p-3 text-xs w-text-dim shadow-lg">
          {children}
        </div>
      )}
    </span>
  );
}

/** "What is a Watcher slot" affordance next to a plan's slot allowance. */
export function SlotInfoPopover() {
  return (
    <InfoPopover label="Learn what a Watcher slot means">
      <p className="mb-1.5">A slot is one Watcher actively deployed to one Community.</p>
      <p>One Watcher deployed to two Communities uses two slots.</p>
    </InfoPopover>
  );
}

/** "What does 'up to N Communities' mean" affordance next to a plan's
 *  expandable Community capacity. */
export function CommunityExpansionInfoPopover({ included, max }: { included: number; max: number }) {
  return (
    <InfoPopover label="Learn how Community expansion works">
      <p>Your plan includes {included} communit{included === 1 ? "y" : "ies"}. Add the Community Expansion package (see the price below) to raise your Community capacity to this plan's maximum of {max} — it never changes your Watcher slot allowance.</p>
    </InfoPopover>
  );
}
