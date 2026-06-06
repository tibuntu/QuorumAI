import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";
import { ensureParticipant, isParticipant, isOwner, documentIdForAnnotation } from "@/lib/authz";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("authz", () => {
  it("ensureParticipant joins on existing doc, false on missing", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");

    expect(await isParticipant(viewer.id, id)).toBe(false);
    expect(await ensureParticipant(viewer.id, id)).toBe(true);
    expect(await isParticipant(viewer.id, id)).toBe(true);
    // idempotent
    expect(await ensureParticipant(viewer.id, id)).toBe(true);

    expect(await ensureParticipant(viewer.id, "does-not-exist")).toBe(false);
    expect(await isParticipant(viewer.id, "does-not-exist")).toBe(false);

    await prisma.document.delete({ where: { id } });
  });

  it("isOwner is true only for the owner", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    expect(await isOwner(owner.id, id)).toBe(true);
    expect(await isOwner(other.id, id)).toBe(false);
    expect(await isOwner(owner.id, "missing")).toBe(false);
    await prisma.document.delete({ where: { id } });
  });

  it("documentIdForAnnotation resolves or returns null", async () => {
    const owner = await makeUser();
    const md = "The cloud setup needs review.";
    const id = await createDocument(owner.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(owner.id, id, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "note");
    expect(await documentIdForAnnotation(ann.id)).toBe(id);
    expect(await documentIdForAnnotation("missing")).toBeNull();
    await prisma.document.delete({ where: { id } });
  });
});
