import { prisma } from "@/lib/db";
import type { Quote } from "@/lib/anchoring";
import type { AnnotationKind, Severity, ThreadStatus } from "@/lib/enums";
import { publish } from "@/lib/events";
import { notifyParticipants } from "@/lib/notifications";
import { dispatch } from "@/lib/webhooks";

export async function createAnnotation(
  userId: string,
  documentId: string,
  anchor: { quote: Quote; startOffset: number; endOffset: number; kind?: AnnotationKind; severity?: Severity | null; category?: string | null },
  body: string
) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  const annotation = await prisma.annotation.create({
    data: {
      documentId,
      createdOnVersionId: doc.currentVersionId,
      kind: anchor.kind ?? "COMMENT",
      anchorExact: anchor.quote.exact,
      anchorPrefix: anchor.quote.prefix,
      anchorSuffix: anchor.quote.suffix,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      severity: anchor.severity ?? null,
      category: anchor.category ?? null,
      authorId: userId,
      comments: { create: { authorId: userId, body } },
    },
    include: { comments: { include: { author: { select: { name: true, email: true } } } }, author: { select: { name: true, email: true } } },
  });
  publish(documentId, { type: "annotation.created", annotation });
  await notifyParticipants(documentId, userId, "comment").catch(() => {});
  await dispatch(documentId, "comment.created", { annotationId: annotation.id }, userId).catch(() => {});
  return annotation;
}

export async function addComment(userId: string, annotationId: string, body: string) {
  const comment = await prisma.comment.create({
    data: { annotationId, authorId: userId, body },
    include: { author: { select: { name: true, email: true } } },
  });
  const ann = await prisma.annotation.findUnique({ where: { id: annotationId }, select: { documentId: true } });
  if (ann) publish(ann.documentId, { type: "comment.created", annotationId, comment });
  if (ann) await notifyParticipants(ann.documentId, userId, "comment").catch(() => {});
  if (ann) await dispatch(ann.documentId, "comment.created", { annotationId }, userId).catch(() => {});
  return comment;
}

export async function setThreadStatus(userId: string, annotationId: string, status: ThreadStatus) {
  const annotation = await prisma.annotation.update({ where: { id: annotationId }, data: { threadStatus: status } });
  publish(annotation.documentId, { type: "annotation.updated", annotationId, threadStatus: status });
  await notifyParticipants(annotation.documentId, userId, "resolve").catch(() => {});
  return annotation;
}
