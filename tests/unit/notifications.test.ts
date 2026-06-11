import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { submitReview } from "@/lib/reviews";
import { buildQuote } from "@/lib/anchoring";
import { notifyParticipants, listNotifications, unreadCount, markAllRead } from "@/lib/notifications";

vi.mock("@/lib/email-digest", () => ({ enqueueEmailEvent: vi.fn() }));

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

  it("enqueues email for opted-in non-actor participants only", async () => {
    const { enqueueEmailEvent } = await import("@/lib/email-digest");
    vi.mocked(enqueueEmailEvent).mockClear();

    const actor = await makeUser(); // A, opted in
    const optedIn = await makeUser(); // B, opted in (default)
    const optedOut = await makeUser(); // C, opted out
    await prisma.user.update({
      where: { id: optedOut.id },
      data: { notificationPrefs: { comment: { inApp: true, email: false, desktop: false } } },
    });

    const docId = await createDocument(actor.id, "Plan", "Some body text."); // actor auto-added as participant
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: optedIn.id } });
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: optedOut.id } });

    await notifyParticipants(docId, actor.id, "comment");

    const calls = vi.mocked(enqueueEmailEvent).mock.calls.map((c) => c[0]);
    expect(calls).toContain(optedIn.id);
    expect(calls).not.toContain(optedOut.id); // opted out
    expect(calls).not.toContain(actor.id); // actor excluded

    await prisma.document.delete({ where: { id: docId } });
  });

  it("does not create an in-app notification when inApp is muted for the type", async () => {
    const actor = await makeUser();
    const muted = await makeUser();
    await prisma.user.update({
      where: { id: muted.id },
      data: { notificationPrefs: { comment: { inApp: false, email: false, desktop: false } } },
    });
    const docId = await createDocument(actor.id, "Plan", "Some body text.");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: muted.id } });

    await notifyParticipants(docId, actor.id, "comment");
    expect(await unreadCount(muted.id)).toBe(0);
    expect(await listNotifications(muted.id)).toHaveLength(0);

    await prisma.document.delete({ where: { id: docId } });
  });

  it("does not enqueue email for resolve events", async () => {
    const { enqueueEmailEvent } = await import("@/lib/email-digest");
    vi.mocked(enqueueEmailEvent).mockClear();

    const actor = await makeUser();
    const other = await makeUser();
    const docId = await createDocument(actor.id, "Plan", "Some body text.");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id } });

    await notifyParticipants(docId, actor.id, "resolve");
    expect(enqueueEmailEvent).not.toHaveBeenCalled();

    await prisma.document.delete({ where: { id: docId } });
  });
});
