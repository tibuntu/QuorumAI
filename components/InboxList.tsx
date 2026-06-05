"use client";
import Link from "next/link";
import { useState } from "react";

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
        <h1 className="text-2xl font-semibold">Inbox</h1>
        {items.length > 0 && (
          <button onClick={onMarkAll} className="text-sm underline">
            Mark all read
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No notifications.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded border">
          {items.map((n) => (
            <li key={n.id} data-testid="notification">
              <Link
                href={`/app/documents/${n.documentId}`}
                onClick={() => onOpen(n.id)}
                className={`flex items-center justify-between gap-4 p-3 hover:bg-gray-50 ${n.read ? "text-gray-500" : "font-medium"}`}
              >
                <span className="flex flex-col">
                  <span>{TYPE_LABELS[n.type] ?? n.type}</span>
                  <span className="text-xs text-gray-500">{n.document.title}</span>
                </span>
                <span className="text-xs text-gray-500">{new Date(n.createdAt).toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
