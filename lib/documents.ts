import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { DocumentSource } from "@/lib/enums";

export async function createDocument(
  userId: string,
  title: string,
  markdown: string,
  opts?: { source?: DocumentSource; agentContext?: string }
) {
  const doc = await prisma.document.create({
    data: { title, ownerId: userId, state: "OPEN", source: opts?.source ?? "WEB", agentContext: opts?.agentContext ?? null },
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
      reviews: { include: { reviewer: { select: { name: true, email: true } } } },
    },
  });
  return doc;
}
