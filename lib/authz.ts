import { prisma } from "@/lib/db";

/**
 * Link-grant entry point: records the caller as a participant of the document
 * (idempotent). Returns false when the document does not exist — callers should
 * translate that to 404 rather than creating an orphan row or leaking existence.
 */
export async function ensureParticipant(userId: string, documentId: string): Promise<boolean> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!doc) return false;
  await prisma.documentParticipant.upsert({
    where: { documentId_userId: { documentId, userId } },
    create: { documentId, userId },
    update: {},
  });
  return true;
}

/** True when the user already has a participant row for the document (no side effect). */
export async function isParticipant(userId: string, documentId: string): Promise<boolean> {
  const row = await prisma.documentParticipant.findUnique({
    where: { documentId_userId: { documentId, userId } },
    select: { id: true },
  });
  return row !== null;
}

/** True when the user owns the document. */
export async function isOwner(userId: string, documentId: string): Promise<boolean> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } });
  return doc?.ownerId === userId;
}

/** Resolve an annotation to its document id, or null when the annotation is missing. */
export async function documentIdForAnnotation(annotationId: string): Promise<string | null> {
  const ann = await prisma.annotation.findUnique({ where: { id: annotationId }, select: { documentId: true } });
  return ann?.documentId ?? null;
}
