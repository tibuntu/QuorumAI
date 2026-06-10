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
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {cursors.map((c) => (
          <span
            key={c.userId}
            data-presence-cursor-user-id={c.userId}
            data-user-name={c.name}
            className="absolute flex items-center gap-1"
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
          >
            <span
              className="block h-3 w-3 rounded-full ring-2 ring-surface"
              style={{ backgroundColor: colorFor(c.userId) }}
            />
            <span
              className="rounded px-1.5 py-0.5 text-xs font-medium text-white whitespace-nowrap"
              style={{ backgroundColor: colorFor(c.userId) }}
            >
              {c.name}
            </span>
          </span>
        ))}
      </div>
      {/* Color→person legend so 3+ participants are identifiable at a glance
          without hovering each cursor/avatar. */}
      {cursors.length >= 2 && (
        <div
          data-testid="cursor-legend"
          className="absolute right-2 top-2 flex flex-col gap-1 rounded-[var(--radius-app)] border border-border bg-surface/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur"
        >
          {cursors.map((c) => (
            <span key={c.userId} className="flex items-center gap-1.5 whitespace-nowrap text-foreground">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorFor(c.userId) }}
              />
              {c.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
