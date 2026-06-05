import { prisma } from "@/lib/db";
import type { Quote } from "@/lib/anchoring";
import type { AnnotationKind, ThreadStatus } from "@/lib/enums";

export async function createAnnotation(
  userId: string,
  documentId: string,
  anchor: { quote: Quote; startOffset: number; endOffset: number; kind?: AnnotationKind },
  body: string
) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  return prisma.annotation.create({
    data: {
      documentId,
      createdOnVersionId: doc.currentVersionId,
      kind: anchor.kind ?? "COMMENT",
      anchorExact: anchor.quote.exact,
      anchorPrefix: anchor.quote.prefix,
      anchorSuffix: anchor.quote.suffix,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      authorId: userId,
      comments: { create: { authorId: userId, body } },
    },
    include: { comments: true },
  });
}

export async function addComment(userId: string, annotationId: string, body: string) {
  return prisma.comment.create({ data: { annotationId, authorId: userId, body } });
}

export async function setThreadStatus(annotationId: string, status: ThreadStatus) {
  return prisma.annotation.update({ where: { id: annotationId }, data: { threadStatus: status } });
}
