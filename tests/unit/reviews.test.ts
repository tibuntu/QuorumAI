import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { submitReview } from "@/lib/reviews";

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
});
