import type { PresenceEntry } from "@/lib/events";

// Theme-aware presence palette. Each entry is a CSS custom-property reference
// resolved from the "Violet consensus" tokens in app/globals.css, which flip
// under :root.dark — so avatar/cursor/selection colors stay readable on both
// the light and dark surfaces. Applied via inline `style`, not Tailwind classes.
export const AVATAR_COLORS = [
  "var(--presence-1)", "var(--presence-2)", "var(--presence-3)", "var(--presence-4)",
  "var(--presence-5)", "var(--presence-6)", "var(--presence-7)", "var(--presence-8)", "var(--presence-9)",
] as const;

export const SELECTION_COLORS = [
  "var(--presence-sel-1)", "var(--presence-sel-2)", "var(--presence-sel-3)", "var(--presence-sel-4)",
  "var(--presence-sel-5)", "var(--presence-sel-6)", "var(--presence-sel-7)", "var(--presence-sel-8)", "var(--presence-sel-9)",
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
