import { prisma } from "@/lib/db";

export async function notifyParticipants(documentId: string, actorId: string, type: string) {
  const [doc, annotations, comments, reviews] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } }),
    prisma.annotation.findMany({ where: { documentId }, select: { authorId: true } }),
    prisma.comment.findMany({ where: { annotation: { documentId } }, select: { authorId: true } }),
    prisma.review.findMany({ where: { documentId }, select: { reviewerId: true } }),
  ]);
  if (!doc) return;
  const ids = new Set<string>([doc.ownerId]);
  for (const a of annotations) ids.add(a.authorId);
  for (const c of comments) ids.add(c.authorId);
  for (const r of reviews) ids.add(r.reviewerId);
  ids.delete(actorId);
  if (ids.size === 0) return;
  await prisma.notification.createMany({ data: [...ids].map((userId) => ({ userId, documentId, actorId, type })) });
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
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}
