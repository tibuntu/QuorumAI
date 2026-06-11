import { prisma } from "@/lib/db";
import { enqueueEmailEvent } from "@/lib/email-digest";
import { publish, type ClientNotification } from "@/lib/events";
import { parsePrefs, isEnabled } from "@/lib/notification-prefs";
import type { NotificationType } from "@/lib/enums";

const EMAILABLE = new Set(["comment", "review", "version"]);

export async function notifyParticipants(documentId: string, actorId: string, type: string) {
  const participants = await prisma.documentParticipant.findMany({
    where: { documentId },
    select: { userId: true, user: { select: { notificationPrefs: true } } },
  });
  const recipients = participants.filter((p) => p.userId !== actorId);
  if (recipients.length === 0) return;

  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { title: true } });
  const documentTitle = doc?.title ?? "";

  const nt = type as NotificationType;
  let actorName: string | null = null; // resolved lazily, only if an email is enqueued

  for (const p of recipients) {
    const prefs = parsePrefs(p.user?.notificationPrefs);

    // In-app: create + publish only if enabled for this type.
    if (isEnabled(prefs, nt, "inApp")) {
      const row = await prisma.notification.create({
        data: { userId: p.userId, documentId, actorId, type },
      });
      const payload: ClientNotification = {
        id: row.id,
        type: row.type,
        documentId,
        documentTitle,
        actorId: row.actorId,
        read: row.read,
        createdAt: row.createdAt.toISOString(),
      };
      publish(`user-${p.userId}`, { type: "notification.created", notification: payload });
    }

    // Email: only emailable types, and only if enabled for this recipient.
    if (EMAILABLE.has(type) && isEnabled(prefs, nt, "email")) {
      if (actorName === null) {
        const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
        actorName = actor?.name ?? "Someone";
      }
      enqueueEmailEvent(p.userId, documentId, type as "comment" | "review" | "version", actorName);
    }
  }
}

export async function listNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: [{ read: "asc" }, { createdAt: "desc" }],
    take: 50,
    include: { document: { select: { title: true } } },
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function markRead(userId: string, id: string) {
  await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
  publish(`user-${userId}`, { type: "notification.read", id });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  publish(`user-${userId}`, { type: "notification.read.all" });
}
