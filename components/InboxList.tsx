"use client";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const TYPE_LABELS: Record<string, string> = {
  comment: "New comment",
  review: "New verdict",
  version: "New version",
  resolve: "Thread resolved",
};

type Notification = {
  id: string;
  type: string;
  documentId: string;
  read: boolean;
  createdAt: Date | string;
  document: { title: string };
};

export default function InboxList({ initial }: { initial: Notification[] }) {
  const [items, setItems] = useState<Notification[]>(initial);

  function onOpen(id: string) {
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  async function onMarkAll() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Inbox</h1>
        {items.length > 0 && (
          <Button variant="secondary" size="sm" onClick={onMarkAll}>
            Mark all read
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No notifications.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li key={n.id} data-testid="notification">
              <Card className={`transition-colors hover:bg-primary-subtle ${n.read ? "" : "border-l-2 border-l-primary"}`}>
                <Link
                  href={`/app/documents/${n.documentId}`}
                  onClick={() => onOpen(n.id)}
                  className={`flex items-center justify-between gap-4 p-3 ${n.read ? "text-muted" : "font-medium text-foreground"}`}
                >
                  <span className="flex flex-col">
                    <span>{TYPE_LABELS[n.type] ?? n.type}</span>
                    <span className="text-xs text-muted">{n.document.title}</span>
                  </span>
                  <span className="text-xs text-muted">{new Date(n.createdAt).toLocaleString()}</span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
