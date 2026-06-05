import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { submitReview } from "@/lib/reviews";
import { buildQuote } from "@/lib/anchoring";
import { notifyParticipants, listNotifications, unreadCount, markAllRead } from "@/lib/notifications";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("notifications", () => {
  it("notifies participants except the actor", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const md = "The cloud setup needs review.";
    const docId = await createDocument(owner.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    await createAnnotation(owner.id, docId, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "note");
    await submitReview(reviewer.id, docId, "APPROVE");

    // actor = reviewer ⇒ only the owner (a participant via ownership + annotation) is notified.
    await notifyParticipants(docId, reviewer.id, "review");
    expect(await unreadCount(owner.id)).toBeGreaterThanOrEqual(1);
    const list = await listNotifications(owner.id);
    expect(list[0].document.title).toBe("Plan");
    expect(list.some((n) => n.userId === reviewer.id)).toBe(false);

    await markAllRead(owner.id);
    expect(await unreadCount(owner.id)).toBe(0);
    await prisma.document.delete({ where: { id: docId } });
  });
});
