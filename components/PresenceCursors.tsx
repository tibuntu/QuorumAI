"use client";
import { colorFor } from "@/lib/presence-roster";
import type { RemoteCursor } from "@/lib/presence-client";

/**
 * Floating overlay of other participants' live cursors. A pointer-events-none
 * child of the (relative) doc-body container, so percent positions map to that
 * box and clicks/selection pass straight through to the document underneath.
 */
export default function PresenceCursors({ cursors }: { cursors: RemoteCursor[] }) {
  if (cursors.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {cursors.map((c) => (
        <span
          key={c.userId}
          data-presence-cursor-user-id={c.userId}
          data-user-name={c.name}
          className="absolute flex items-center gap-1"
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
        >
          <span className={`${colorFor(c.userId)} block h-3 w-3 rounded-full ring-2 ring-surface`} />
          <span
            className={`${colorFor(c.userId)} rounded px-1.5 py-0.5 text-xs font-medium text-white whitespace-nowrap`}
          >
            {c.name}
          </span>
        </span>
      ))}
    </div>
  );
}
