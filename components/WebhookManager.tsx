"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/enums";

type WebhookRow = {
  id: string;
  url: string;
  events: string;
  active: boolean;
  lastStatus: string | null;
  lastDeliveredAt: Date | string | null;
};

export default function WebhookManager({ initialWebhooks }: { initialWebhooks: WebhookRow[] }) {
  const [hooks, setHooks] = useState<WebhookRow[]>(initialWebhooks);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["decision.changed"]);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggle(e: WebhookEvent) {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, events }),
      });
      if (res.status !== 201) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to create webhook");
        return;
      }
      const { id, secret } = await res.json();
      setCreated(secret);
      setHooks((prev) => [{ id, url, events: events.join(","), active: true, lastStatus: null, lastDeliveredAt: null }, ...prev]);
      setUrl("");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    setHooks((prev) => prev.filter((h) => h.id !== id));
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Webhooks</h1>

      <Card className="p-4">
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Endpoint URL
            <Input
              aria-label="webhook url"
              placeholder="https://ci.example.com/quorum"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <fieldset className="flex flex-col gap-1 text-sm text-foreground">
            <legend className="text-xs text-muted">Events</legend>
            {WEBHOOK_EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={e}
                  checked={events.includes(e)}
                  onChange={() => toggle(e)}
                />
                {e}
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={submitting || events.length === 0 || !url}>
            Create webhook
          </Button>
        </form>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-[var(--state-changes)]">
          {error}
        </p>
      )}

      {created && (
        <Card className="flex flex-col gap-2 border-[var(--state-approved)] bg-[var(--state-approved-bg)] p-4">
          <p className="text-sm font-medium text-foreground">Copy this signing secret now — it won&apos;t be shown again.</p>
          <Input
            data-testid="new-webhook-secret"
            readOnly
            value={created}
            className="font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button variant="ghost" size="sm" onClick={() => setCreated(null)} className="self-start">
            Done
          </Button>
        </Card>
      )}

      {hooks.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No webhooks yet.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {hooks.map((h) => (
            <li key={h.id}>
              <Card className="flex items-center justify-between gap-4 p-3" data-testid="webhook-row">
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{h.url}</span>
                  <span className="text-xs text-muted">{h.events}</span>
                  <span className="text-xs text-muted" data-testid="webhook-status">
                    {h.lastStatus
                      ? `Last: ${h.lastStatus}${h.lastDeliveredAt ? ` @ ${new Date(h.lastDeliveredAt).toLocaleString()}` : ""}`
                      : "Never delivered"}
                  </span>
                </span>
                <Button variant="danger" size="sm" onClick={() => onDelete(h.id)}>
                  Delete
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
