import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CELLS,
  type NotificationType,
  type NotificationChannel,
} from "@/lib/enums";

export type ChannelFlags = Partial<Record<NotificationChannel, boolean>>;
export type NotificationPrefs = Record<NotificationType, ChannelFlags>;

export const DEFAULT_PREFS: NotificationPrefs = {
  comment: { inApp: true, email: true, desktop: false },
  review: { inApp: true, email: true, desktop: false },
  version: { inApp: true, email: true, desktop: false },
  resolve: { inApp: true, desktop: false },
};

function freshDefaults(): NotificationPrefs {
  return {
    comment: { ...DEFAULT_PREFS.comment },
    review: { ...DEFAULT_PREFS.review },
    version: { ...DEFAULT_PREFS.version },
    resolve: { ...DEFAULT_PREFS.resolve },
  };
}

export function isValidCell(type: string, channel: string): boolean {
  const channels = NOTIFICATION_CELLS[type as NotificationType] as readonly string[] | undefined;
  return !!channels && channels.includes(channel);
}

export function parsePrefs(json: unknown): NotificationPrefs {
  const out = freshDefaults();
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const type of NOTIFICATION_TYPES) {
      const cell = obj[type];
      if (cell && typeof cell === "object") {
        const cellObj = cell as Record<string, unknown>;
        for (const channel of NOTIFICATION_CELLS[type]) {
          const v = cellObj[channel];
          if (typeof v === "boolean") out[type][channel] = v;
        }
      }
    }
  }
  return out;
}

export function isEnabled(
  prefs: NotificationPrefs,
  type: NotificationType,
  channel: NotificationChannel,
): boolean {
  return prefs[type]?.[channel] === true;
}

export function applyPatch(
  prefs: NotificationPrefs,
  type: NotificationType,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationPrefs {
  if (!isValidCell(type, channel)) throw new Error(`invalid notification cell: ${type}.${channel}`);
  return { ...prefs, [type]: { ...prefs[type], [channel]: enabled } };
}
