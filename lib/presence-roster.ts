import type { PresenceEntry } from "@/lib/events";

export const AVATAR_COLORS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500",
  "bg-teal-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500",
] as const;

export const SELECTION_COLORS = [
  "bg-rose-500/25", "bg-orange-500/25", "bg-amber-500/25", "bg-emerald-500/25",
  "bg-teal-500/25", "bg-sky-500/25", "bg-indigo-500/25", "bg-violet-500/25", "bg-fuchsia-500/25",
] as const;

export const MAX_VISIBLE_AVATARS = 4;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashOf(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return hash;
}

export function colorFor(userId: string): string {
  return AVATAR_COLORS[hashOf(userId) % AVATAR_COLORS.length];
}

/** Translucent selection tint matching the user's avatar color. */
export function selectionColorFor(userId: string): string {
  return SELECTION_COLORS[hashOf(userId) % SELECTION_COLORS.length];
}

export function viewingLabel(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"} viewing`;
}

export function displayName(entry: PresenceEntry, currentUserId: string): string {
  return entry.userId === currentUserId ? `${entry.name} (you)` : entry.name;
}

/** Current user first, then others ordered stably by userId. Does not mutate the input. */
export function orderRoster(roster: PresenceEntry[], currentUserId: string): PresenceEntry[] {
  return [...roster].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return a.userId < b.userId ? -1 : 1;
  });
}
