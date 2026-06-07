import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook } from "@/lib/webhooks";
import { submitReview } from "@/lib/reviews";
import { addComment } from "@/lib/annotations";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}
async function makeDocWithVersion(ownerId: string) {
  const doc = await prisma.document.create({ data: { title: "D", ownerId, requiredApprovals: 1 } });
  const v = await prisma.documentVersion.create({ data: { documentId: doc.id, versionNumber: 1, markdown: "hello world", contentHash: "h1", createdById: ownerId } });
  return prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: v.id } });
}
async function eventsFor(webhookId: string): Promise<string[]> {
  const jobs = await prisma.outboxJob.findMany({ where: { type: "webhook.deliver" } });
  return jobs.map((j) => JSON.parse(j.payload)).filter((p) => p.webhookId === webhookId).map((p) => p.event);
}

describe("event wiring → webhooks", () => {
  beforeEach(async () => { await prisma.outboxJob.deleteMany({}); });

  it("review approval fires review.updated AND decision.changed", async () => {
    const u = await makeUser();
    const doc = await makeDocWithVersion(u.id);
    const { id } = await createWebhook(u.id, { url: "https://e.com/h", events: ["review.updated", "decision.changed"] });
    await submitReview(u.id, doc.id, "APPROVE");
    const evts = await eventsFor(id);
    expect(evts).toContain("review.updated");
    expect(evts).toContain("decision.changed");
  });

  it("comment fires comment.created", async () => {
    const u = await makeUser();
    const doc = await makeDocWithVersion(u.id);
    const ann = await prisma.annotation.create({ data: { documentId: doc.id, createdOnVersionId: doc.currentVersionId!, kind: "COMMENT", authorId: u.id } });
    const { id } = await createWebhook(u.id, { url: "https://e.com/h", events: ["comment.created"] });
    await addComment(u.id, ann.id, "a reply");
    expect(await eventsFor(id)).toContain("comment.created");
  });
});
