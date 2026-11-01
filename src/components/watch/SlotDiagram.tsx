import React from "react";
import { Bot, Users } from "lucide-react";

export interface SlotDiagramExample {
  caption: string;
  watchers: string[];
  communities: string[];
  /** [watcherIndex, communityIndex] pairs — one active deployment each. */
  connections: Array<[number, number]>;
}

const ROW_HEIGHT = 44;
const NODE_W = 96;
const NODE_H = 28;

/** A real rendered diagram (SVG connector lines, not ASCII) showing which
 *  Watcher(s) deploy to which Community(ies) and how many slots that
 *  consumes — one line per active deployment, matching the canonical
 *  "one slot = one active deployment" definition exactly (connections.length
 *  === slots used, always, never a separately-typed number that could
 *  drift from the diagram itself). */
export function SlotDiagram({ caption, watchers, communities, connections }: SlotDiagramExample) {
  const rows = Math.max(watchers.length, communities.length);
  const height = rows * ROW_HEIGHT + 20;
  const leftX = 10;
  const rightX = 300 - NODE_W - 10;
  const yFor = (i: number) => 10 + i * ROW_HEIGHT + NODE_H / 2;

  return (
    <div className="w-surface-raised border w-line-soft rounded-lg p-3">
      <svg viewBox={`0 0 300 ${height}`} className="w-full" style={{ height: `${height}px` }} role="img" aria-label={caption}>
        {connections.map(([wi, ci], idx) => (
          <line
            key={idx}
            x1={leftX + NODE_W}
            y1={yFor(wi)}
            x2={rightX}
            y2={yFor(ci)}
            stroke="var(--w-teal)"
            strokeWidth={1.5}
            strokeOpacity={0.55}
          />
        ))}
        {watchers.map((name, i) => (
          <g key={`w-${i}`} transform={`translate(${leftX}, ${yFor(i) - NODE_H / 2})`}>
            <rect width={NODE_W} height={NODE_H} rx={7} fill="var(--w-surface)" stroke="var(--w-teal-border)" />
            <foreignObject width={NODE_W} height={NODE_H}>
              <div className="h-full flex items-center gap-1.5 px-2 text-[11px] w-text">
                <Bot size={11} className="w-teal shrink-0" />
                <span className="truncate">{name}</span>
              </div>
            </foreignObject>
          </g>
        ))}
        {communities.map((name, i) => (
          <g key={`c-${i}`} transform={`translate(${rightX}, ${yFor(i) - NODE_H / 2})`}>
            <rect width={NODE_W} height={NODE_H} rx={7} fill="var(--w-surface)" stroke="var(--w-line)" />
            <foreignObject width={NODE_W} height={NODE_H}>
              <div className="h-full flex items-center gap-1.5 px-2 text-[11px] w-text">
                <Users size={11} className="w-text-faint shrink-0" />
                <span className="truncate">{name}</span>
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
      <p className="text-xs w-text-dim mt-2">{caption} — <span className="w-teal font-semibold">{connections.length} slot{connections.length === 1 ? "" : "s"} used</span></p>
    </div>
  );
}
