import React from "react";

/** Compact 3-up summary strip at the top of Settings — real current state
 *  only, no fabricated statuses. Security has no per-account "last changed"
 *  timestamp or session data anywhere in this codebase, so it shows the one
 *  thing that's actually, structurally true (email & password is the only
 *  sign-in method) rather than inventing one. */
export function SettingsSummary({
  timezone, notificationsEnabledCount, notificationsTotalCount,
}: {
  timezone: string;
  notificationsEnabledCount: number;
  notificationsTotalCount: number;
}) {
  const items = [
    { label: "Timezone", value: timezone },
    { label: "Notifications", value: `${notificationsEnabledCount} of ${notificationsTotalCount} enabled` },
    { label: "Security", value: "Email & password" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.label} className="w-surface-raised border w-line-soft rounded-lg px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-0.5">{item.label}</p>
          <p className="text-sm w-text truncate">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
