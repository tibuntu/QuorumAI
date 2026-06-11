import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { parsePrefs, DEFAULT_PREFS } from "@/lib/notification-prefs";

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

  it("User notificationPrefs is null on create and parses to defaults", async () => {
    const now = new Date();
    const u = await prisma.user.create({
      data: { id: `pref-${Date.now()}`, name: "Pref", email: `pref-${Date.now()}@e.com`, emailVerified: false, createdAt: now, updatedAt: now },
    });
    expect(u.notificationPrefs).toBeNull();
    const prefs = parsePrefs(u.notificationPrefs);
    expect(prefs).toEqual(DEFAULT_PREFS);
    expect(prefs.comment.email).toBe(true);
  });

  it("OutboxJob defaults to PENDING with attempts=0, maxAttempts=6", async () => {
    const job = await prisma.outboxJob.create({
      data: { type: "email.digest", payload: JSON.stringify({ a: 1 }) },
    });
    expect(job.status).toBe("PENDING");
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(6);
    expect(job.nextAttemptAt).toBeInstanceOf(Date);
    await prisma.outboxJob.delete({ where: { id: job.id } });
  });

  it("Annotation severity/category default to null and round-trip", async () => {
    const now = new Date();
    const user = await prisma.user.create({
      data: { id: `sev-${Date.now()}`, name: "Sev", email: `sev-${Date.now()}@e.com`, emailVerified: false, createdAt: now, updatedAt: now },
    });
    const doc = await prisma.document.create({ data: { title: "Sev Doc", ownerId: user.id } });
    const v1 = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, markdown: "# Hi", contentHash: "h", createdById: user.id },
    });
    const plain = await prisma.annotation.create({
      data: { documentId: doc.id, createdOnVersionId: v1.id, authorId: user.id },
    });
    expect(plain.severity).toBeNull();
    expect(plain.category).toBeNull();
    const tagged = await prisma.annotation.create({
      data: { documentId: doc.id, createdOnVersionId: v1.id, authorId: user.id, severity: "BLOCKER", category: "security" },
    });
    expect(tagged.severity).toBe("BLOCKER");
    expect(tagged.category).toBe("security");
    await prisma.document.delete({ where: { id: doc.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
