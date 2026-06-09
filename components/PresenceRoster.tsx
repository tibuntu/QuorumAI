"use client";
import type { PresenceEntry } from "@/lib/events";
import {
  colorFor,
  displayName,
  initials,
  MAX_VISIBLE_AVATARS,
  orderRoster,
  viewingLabel,
} from "@/lib/presence-roster";

export default function PresenceRoster({
  roster,
  currentUserId,
}: {
  roster: PresenceEntry[];
  currentUserId: string;
}) {
  if (roster.length === 0) return null;

  const sorted = orderRoster(roster, currentUserId);
  const visible = sorted.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = sorted.length - visible.length;
  const allNames = sorted.map((e) => displayName(e, currentUserId)).join(", ");

  return (
    <div
      data-testid="presence-roster"
      aria-label={viewingLabel(roster.length)}
      title={allNames}
      className="flex items-center"
    >
      <div className="flex -space-x-2">
        {visible.map((e) => {
          const name = displayName(e, currentUserId);
          return (
            <span
              key={e.userId}
              data-testid="presence-avatar"
              data-user-name={name}
              title={name}
              className={`${colorFor(e.userId)} flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-surface`}
            >
              {initials(e.name)}
            </span>
          );
        })}
        {overflow > 0 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground ring-2 ring-surface">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
