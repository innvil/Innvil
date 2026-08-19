"use client";

import React, { useState } from "react";
import { Coins } from "lucide-react";
import { AddCreditCard } from "./AddCreditCard";
import type { InnvilCreditBalance, CreditActivityItem } from "@/src/lib/products/innvil-credit";
import { formatUsd } from "@/src/lib/products/innvil-credit-format";
import { SectionHeader, EmptyRow } from "./WatchUI";

const TYPE_LABEL: Record<string, string> = {
  crypto_top_up: "Crypto top-up",
  subscription_purchase: "Subscription purchase",
  subscription_renewal: "Subscription renewal",
  adjustment: "Adjustment",
};

/** Innvil Credit is presented as reusable, account-owned prepaid service
 *  credit -- deliberately never "wallet"/"balance" in the crypto-custody
 *  sense (no coin/token quantity, no withdrawal, no transfer). */
export function InnvilCreditSection({ initialBalance, initialActivity }: { initialBalance: InnvilCreditBalance; initialActivity: CreditActivityItem[] }) {
  const [balance, setBalance] = useState(initialBalance);
  const [activity] = useState(initialActivity);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="w-card p-5">
      <SectionHeader icon={Coins} title="Innvil Credit" />
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Available</p>
          <p className="w-display text-2xl w-teal">{formatUsd(balance.balanceCents)}</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg">Add credit</button>
      </div>
      <p className="text-xs w-text-faint mb-4">
        Reusable prepaid credit for eligible Innvil services. Eligible Watch plans receive preferred Innvil Credit pricing.
        Innvil Credit is non-transferable and cannot be withdrawn as crypto; purchases are generally non-refundable except
        where required by applicable law.
      </p>

      <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2">Credit activity</p>
      {activity.length === 0 ? (
        <EmptyRow text="No credit activity yet." />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                <th className="font-semibold pb-2 px-1">Date</th>
                <th className="font-semibold pb-2 px-1">Description</th>
                <th className="font-semibold pb-2 px-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id} className="border-t w-line-soft">
                  <td className="py-2.5 px-1 w-text-dim whitespace-nowrap">{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td className="py-2.5 px-1 w-text">{a.description ?? TYPE_LABEL[a.type] ?? a.type}</td>
                  <td className={`py-2.5 px-1 whitespace-nowrap ${a.amountCents >= 0 ? "w-teal" : "w-text-dim"}`}>
                    {a.amountCents >= 0 ? "+" : "-"}${(Math.abs(a.amountCents) / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <AddCreditCard onClose={() => { setAddOpen(false); }} />}
    </div>
  );
}
