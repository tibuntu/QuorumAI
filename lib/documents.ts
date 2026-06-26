import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { DocumentSource } from "@/lib/enums";

export async function createDocument(
  userId: string,
  title: string,
  markdown: string,
  opts?: { source?: DocumentSource; agentContext?: string; requiredApprovals?: number; idempotencyKey?: string }
) {
  const doc = await prisma.document.create({
    data: {
      title,
      ownerId: userId,
      state: "OPEN",
      source: opts?.source ?? "WEB",
      agentContext: opts?.agentContext ?? null,
      idempotencyKey: opts?.idempotencyKey ?? null,
      requiredApprovals: opts?.requiredApprovals ?? 1,
    },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"),
      createdById: userId,
    },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  await prisma.documentParticipant.create({ data: { documentId: doc.id, userId } });
  return doc.id;
}

/** Idempotent-create support: find an owner's plan previously created with
 *  the same client idempotency key, if any. */
export async function findPlanByIdempotencyKey(ownerId: string, idempotencyKey: string) {
  return prisma.document.findFirst({ where: { ownerId, idempotencyKey }, select: { id: true } });
}

/** Hard-delete a document and all dependents. Ordered to satisfy the
 *  onDelete: Restrict FKs on DocumentVersion (Annotation.created/appliedInVersion,
 *  Review.onVersion): remove reviews + annotations (comments cascade) first, then
 *  the document (versions, participants, notifications cascade). Single transaction. */
export async function deleteDocument(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.review.deleteMany({ where: { documentId: id } }),
    prisma.annotation.deleteMany({ where: { documentId: id } }),
    prisma.document.delete({ where: { id } }),
  ]);
}

export async function listDocuments(userId: string) {
  return prisma.document.findMany({
    where: { participants: { some: { userId } } },
    orderBy: { updatedAt: "desc" },
    include: { owner: { select: { name: true, email: true } } },
  });
}

export async function getDocumentDetail(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      currentVersion: true,
      owner: { select: { name: true, email: true } },
      versions: {
        orderBy: { versionNumber: "asc" },
        select: { versionNumber: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
      },
      annotations: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { name: true, email: true } },
          comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
          createdOnVersion: { select: { versionNumber: true } },
          appliedInVersion: { select: { versionNumber: true } },
        },
      },
      reviews: { include: { reviewer: { select: { name: true, email: true } }, onVersion: { select: { versionNumber: true } } } },
    },
  });
  return doc;
}
