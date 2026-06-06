import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";

describe("domain schema", () => {
  it("round-trips a document chain and cascades on delete", async () => {
    const now = new Date();
    const user = await prisma.user.create({
      data: { id: `u-${Date.now()}`, name: "Owner", email: `o-${Date.now()}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
    });
    const doc = await prisma.document.create({ data: { title: "Plan A", ownerId: user.id } });
    const v1 = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, markdown: "# Hi", contentHash: "abc", createdById: user.id },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: v1.id } });
    const ann = await prisma.annotation.create({
      data: { documentId: doc.id, createdOnVersionId: v1.id, authorId: user.id, anchorExact: "Hi" },
    });
    await prisma.comment.create({ data: { annotationId: ann.id, authorId: user.id, body: "looks good" } });

    const loaded = await prisma.document.findUnique({
      where: { id: doc.id },
      include: { versions: true, annotations: { include: { comments: true } } },
    });
    expect(loaded?.versions).toHaveLength(1);
    expect(loaded?.annotations[0].comments[0].body).toBe("looks good");
    expect(loaded?.state).toBe("DRAFT");

    await prisma.document.delete({ where: { id: doc.id } });
    expect(await prisma.annotation.findUnique({ where: { id: ann.id } })).toBeNull();
  });

  it("User has emailNotifications defaulting to true", async () => {
    const now = new Date();
    const u = await prisma.user.create({
      data: { id: `pref-${Date.now()}`, name: "Pref", email: `pref-${Date.now()}@e.com`, emailVerified: false, createdAt: now, updatedAt: now },
    });
    expect(u.emailNotifications).toBe(true);
  });
});
