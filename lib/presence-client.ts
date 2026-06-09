import type { DocEvent, PresenceEntry } from "@/lib/events";

/** Pure reduction of a presence event into the next roster, keyed by userId. */
export function applyPresenceEvent(
  roster: PresenceEntry[],
  event: DocEvent,
  self: { userId: string; name: string },
): PresenceEntry[] {
  switch (event.type) {
    case "presence.sync": {
      const hasSelf = event.roster.some((p) => p.userId === self.userId);
      return hasSelf
        ? event.roster
        : [...event.roster, { userId: self.userId, name: self.name, lastSeen: Date.now() }];
    }
    case "presence.updated": {
      const others = roster.filter((p) => p.userId !== event.entry.userId);
      return [...others, event.entry];
    }
    case "presence.left":
      return roster.filter((p) => p.userId !== event.userId);
    default:
      return roster;
  }
}
