import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { submitReview, setRequiredApprovals } from "@/lib/reviews";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random()*1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random()*1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("reviews service", () => {
  it("change request dominates, then approvals approve", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const docId = await createDocument(u1.id, "Plan", "The cloud setup needs review.");

    await submitReview(u1.id, docId, "REQUEST_CHANGES");
    const afterU2 = await submitReview(u2.id, docId, "APPROVE");
    expect(afterU2).toBe("CHANGES_REQUESTED");

    const afterU1Approve = await submitReview(u1.id, docId, "APPROVE");
    expect(afterU1Approve).toBe("APPROVED");

    await prisma.document.delete({ where: { id: docId } });
  });

  it("raising the threshold above current approvals flips APPROVED→OPEN", async () => {
    const owner = await makeUser();
    const r1 = await makeUser();
    const docId = await createDocument(owner.id, "P", "body"); // requiredApprovals defaults to 1
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: r1.id } });
    await submitReview(r1.id, docId, "APPROVE"); // 1 approval ≥ 1 → APPROVED
    expect((await prisma.document.findUnique({ where: { id: docId } }))?.state).toBe("APPROVED");

    const state = await setRequiredApprovals(owner.id, docId, 2); // now needs 2
    expect(state).toBe("OPEN");
    const doc = await prisma.document.findUnique({ where: { id: docId } });
    expect(doc?.requiredApprovals).toBe(2);
    expect(doc?.state).toBe("OPEN");
    await prisma.document.delete({ where: { id: docId } });
  });

  it("lowering the threshold to/below current approvals flips OPEN→APPROVED", async () => {
    const owner = await makeUser();
    const r1 = await makeUser();
    const docId = await createDocument(owner.id, "P", "body", { requiredApprovals: 2 });
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: r1.id } });
    await submitReview(r1.id, docId, "APPROVE"); // 1 of 2 → OPEN
    expect((await prisma.document.findUnique({ where: { id: docId } }))?.state).toBe("OPEN");

    const state = await setRequiredApprovals(owner.id, docId, 1);
    expect(state).toBe("APPROVED");
    await prisma.document.delete({ where: { id: docId } });
  });

  it("an active REQUEST_CHANGES keeps CHANGES_REQUESTED regardless of threshold", async () => {
    const owner = await makeUser();
    const r1 = await makeUser();
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: r1.id } });
    await submitReview(r1.id, docId, "REQUEST_CHANGES");
    const state = await setRequiredApprovals(owner.id, docId, 1);
    expect(state).toBe("CHANGES_REQUESTED");
    await prisma.document.delete({ where: { id: docId } });
  });
});
