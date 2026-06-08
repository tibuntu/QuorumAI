import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listNotifications, unreadCount } from "@/lib/notifications";
import { prisma } from "@/lib/db";
import { AppNav } from "@/components/AppNav";
import { NotificationProvider } from "@/components/NotificationProvider";
import type { ClientNotification } from "@/lib/events";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [unread, rows, pref] = await Promise.all([
    unreadCount(session.user.id),
    listNotifications(session.user.id),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { desktopNotifications: true } }),
  ]);

  const initialItems: ClientNotification[] = rows.map((n) => ({
    id: n.id,
    type: n.type,
    documentId: n.documentId,
    documentTitle: n.document.title,
    actorId: n.actorId,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <NotificationProvider
      initialUnread={unread}
      desktopEnabled={pref?.desktopNotifications ?? false}
      initialItems={initialItems}
    >
      <div className="min-h-screen bg-background">
        <AppNav email={session.user.email} />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </div>
    </NotificationProvider>
  );
}
