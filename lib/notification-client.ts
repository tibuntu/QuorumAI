import type { DocEvent } from "@/lib/events";

export function nextUnread(count: number, e: DocEvent): number {
  switch (e.type) {
    case "notification.created":
      return count + 1;
    case "notification.read":
      return Math.max(0, count - 1);
    case "notification.read.all":
      return 0;
    default:
      return count;
  }
}

export function shouldFireOsNotification(args: {
  desktopPrefs: Record<string, boolean>;
  type: string;
  permission: NotificationPermission;
  visibility: DocumentVisibilityState;
  seen: Set<string>;
  id: string;
}): boolean {
  const { desktopPrefs, type, permission, visibility, seen, id } = args;
  return (
    desktopPrefs[type] === true &&
    permission === "granted" &&
    visibility === "hidden" &&
    !seen.has(id)
  );
}
