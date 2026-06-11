"use client";
import { useState } from "react";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  type NotificationType,
  type NotificationChannel,
} from "@/lib/enums";
import { isValidCell, type NotificationPrefs } from "@/lib/notification-prefs";

const TYPE_LABELS: Record<NotificationType, string> = {
  comment: "Comments & replies",
  review: "Reviews & verdicts",
  version: "New versions",
  resolve: "Thread resolved",
};
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  inApp: "In-app",
  email: "Email",
  desktop: "Desktop",
};

export function NotificationSettings({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [saving, setSaving] = useState(false);

  async function toggle(type: NotificationType, channel: NotificationChannel) {
    const next = !(prefs[type]?.[channel] === true);

    // Desktop opt-in requires OS permission.
    if (
      channel === "desktop" &&
      next &&
      typeof Notification !== "undefined" &&
      (await Notification.requestPermission()) !== "granted"
    ) {
      return; // permission denied → leave off, persist nothing
    }

    const prev = prefs;
    setPrefs((p) => ({ ...p, [type]: { ...p[type], [channel]: next } }));
    setSaving(true);
    const res = await fetch("/api/settings/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, channel, enabled: next }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) setPrefs(prev); // revert on failure
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
      <p className="text-sm text-muted">Choose how you&apos;re notified for each kind of activity on your documents.</p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-muted">
              <th className="p-2 text-left font-medium">Activity</th>
              {NOTIFICATION_CHANNELS.map((c) => (
                <th key={c} className="p-2 text-center font-medium">{CHANNEL_LABELS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((type) => (
              <tr key={type} className="border-t border-border">
                <td className="p-2 text-foreground">{TYPE_LABELS[type]}</td>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const exists = isValidCell(type, channel);
                  return (
                    <td key={channel} className="p-2 text-center">
                      <input
                        type="checkbox"
                        data-testid={`pref-${type}-${channel}`}
                        className="accent-[var(--primary)]"
                        checked={prefs[type]?.[channel] === true}
                        disabled={!exists || saving}
                        aria-label={`${TYPE_LABELS[type]} — ${CHANNEL_LABELS[channel]}`}
                        onChange={() => exists && toggle(type, channel)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">Emails are only sent when the server has SMTP configured.</p>
    </div>
  );
}
