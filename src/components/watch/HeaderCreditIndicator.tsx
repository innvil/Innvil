"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins } from "lucide-react";
import { AddCreditCard } from "./AddCreditCard";
import { formatUsd } from "@/src/lib/products/innvil-credit-format";

/**
 * Account-wide Innvil Credit indicator for the authenticated Watch header --
 * placed near account-level controls (not under Workspace/Operations), since
 * Innvil Credit belongs to the Innvil account, never to Watch specifically.
 * Reuses the SAME canonical balance read (`getInnvilCreditBalanceAction` ->
 * `getInnvilCreditBalance`, the exact function Billing's own Innvil Credit
 * section calls) and the SAME real top-up flow (`AddCreditCard`) -- never a
 * second query path or a second implementation. Zero balance is shown as
 * "$0.00", never hidden, so the feature stays discoverable.
 */
export function HeaderCreditIndicator({ balanceCents }: { balanceCents: number }) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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

  const usd = formatUsd(balanceCents);

  return (
    <span ref={ref} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Innvil Credit balance: ${usd}`}
        className="text-xs w-text-dim hover:w-text flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border w-line-soft"
      >
        <Coins size={13} className="w-teal" aria-hidden="true" />
        <span className="hidden sm:inline">Credit</span>
        <span className="w-text font-medium">{usd}</span>
      </button>

      {open && (
        <div role="menu" aria-label="Innvil Credit" className="absolute z-30 top-10 right-0 w-60 w-card-raised border w-teal-border p-3 text-xs shadow-lg">
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Innvil Credit</p>
          <p className="w-display text-lg w-teal mb-1">{usd} available</p>
          <p className="w-text-faint mb-3">1 Innvil Credit = $1.00 USD, usable for eligible Innvil services.</p>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => { setOpen(false); setAddOpen(true); }}
              className="w-btn-primary text-xs font-semibold py-1.5 rounded-lg"
            >
              Add credit
            </button>
            <Link href="/billing" onClick={() => setOpen(false)} className="text-xs w-teal hover:underline text-center py-1">
              View billing
            </Link>
          </div>
        </div>
      )}

      {addOpen && <AddCreditCard onClose={() => setAddOpen(false)} />}
    </span>
  );
}
