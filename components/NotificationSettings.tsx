"use client";
import { useState } from "react";

export function NotificationSettings({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  async function toggle() {
    const next = !on;
    setOn(next);
    setSaving(true);
    await fetch("/api/settings/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailNotifications: next }),
    }).catch(() => setOn(!next));
    setSaving(false);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
      <label className="flex items-center gap-3 text-sm text-foreground">
        <input type="checkbox" data-testid="email-pref" checked={on} disabled={saving} onChange={toggle} />
        Email me about activity on my documents
      </label>
      <p className="text-sm text-muted">Emails are only sent when the server has SMTP configured.</p>
    </div>
  );
}
