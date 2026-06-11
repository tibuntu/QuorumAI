"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ClientNotification, DocEvent } from "@/lib/events";
import { nextUnread, shouldFireOsNotification } from "@/lib/notification-client";

interface Ctx {
  unread: number;
  items: ClientNotification[];
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<Ctx | null>(null);

export function useNotifications(): Ctx {
  const c = useContext(NotificationContext);
  if (!c) throw new Error("useNotifications must be used within NotificationProvider");
  return c;
}

export function NotificationProvider({
  initialUnread,
  desktopPrefs,
  initialItems = [],
  children,
}: {
  initialUnread: number;
  desktopPrefs: Record<string, boolean>;
  initialItems?: ClientNotification[];
  children: React.ReactNode;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<ClientNotification[]>(initialItems);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      es = new EventSource("/api/notifications/stream");
      es.onmessage = (ev) => {
        const e = JSON.parse(ev.data) as DocEvent;
        setUnread((u) => nextUnread(u, e));
        if (e.type === "notification.created") {
          setItems((prev) => (prev.some((n) => n.id === e.notification.id) ? prev : [e.notification, ...prev]));
          if (
            shouldFireOsNotification({
              desktopPrefs,
              type: e.notification.type,
              permission: typeof Notification !== "undefined" ? Notification.permission : "denied",
              visibility: document.visibilityState,
              seen: seen.current,
              id: e.notification.id,
            })
          ) {
            seen.current.add(e.notification.id);
            new Notification(e.notification.documentTitle || "Quorum AI", { body: `New ${e.notification.type}` });
          }
        } else if (e.type === "notification.read") {
          setItems((prev) => prev.map((n) => (n.id === e.id ? { ...n, read: true } : n)));
        } else if (e.type === "notification.read.all") {
          setItems((prev) => prev.map((n) => ({ ...n, read: true })));
        }
      };
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        retry = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      stopped = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [desktopPrefs]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Quorum AI` : "Quorum AI";
  }, [unread]);

  // Note: marking read publishes a per-user event that echoes back over this same
  // EventSource, so unread/read-state converge from the SSE stream. We optimistically
  // flip the item's read flag (idempotent with the echo) but let the echo drive `unread`
  // to avoid double-counting the decrement.
  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }, []);

  return (
    <NotificationContext.Provider value={{ unread, items, markRead, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}
