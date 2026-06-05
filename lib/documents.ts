import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export async function createDocument(userId: string, title: string, markdown: string) {
  const doc = await prisma.document.create({
    data: { title, ownerId: userId, state: "OPEN", source: "WEB" },
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
  return doc.id;
}

export async function listDocuments() {
  return prisma.document.findMany({
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
      annotations: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { name: true, email: true } },
          comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
        },
      },
      reviews: { include: { reviewer: { select: { name: true, email: true } } } },
    },
  });
  return doc;
}
