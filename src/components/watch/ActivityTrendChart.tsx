"use client";

import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { ActivityTrendPoint } from "@/src/lib/products/watch-runtime";

function formatDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Real activity-over-time line chart — every point is a genuine daily
 *  bucket count from `getAccountActivityTrend` (same filters as the event
 *  list below it on the Activity page), zero-count days included, never
 *  sample data. */
export function ActivityTrendChart({ points }: { points: ActivityTrendPoint[] }) {
  const total = points.reduce((s, p) => s + p.count, 0);
  if (total === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm w-text-dim mb-1">No activity in this period.</p>
        <p className="text-xs w-text-faint">Try changing your date range or filters.</p>
      </div>
    );
  }

  const data = points.map((p) => ({ date: p.date, label: formatDay(p.date), count: p.count }));

  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--w-line-soft)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--w-text-faint)", fontSize: 11 }} axisLine={{ stroke: "var(--w-line)" }} tickLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fill: "var(--w-text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            contentStyle={{ background: "var(--w-surface)", border: "1px solid var(--w-line)", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "var(--w-text)" }}
            itemStyle={{ color: "var(--w-teal)" }}
            formatter={(value: number) => [`${value} action${value === 1 ? "" : "s"}`, "Activity"]}
          />
          <Line type="monotone" dataKey="count" stroke="var(--w-teal)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
