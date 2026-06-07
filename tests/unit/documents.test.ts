import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument, getDocumentDetail, listDocuments } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random()*1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random()*1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("documents service", () => {
  it("creates a doc with v1 and fetches detail", async () => {
    const user = await makeUser();
    const id = await createDocument(user.id, "Plan", "# Heading\n\ncloud setup");
    const detail = await getDocumentDetail(id);
    expect(detail?.state).toBe("OPEN");
    expect(detail?.currentVersion?.markdown).toContain("cloud setup");
    const all = await listDocuments(user.id);
    expect(all.find((d) => d.id === id)).toBeTruthy();
    await prisma.document.delete({ where: { id } });
  });

  it("does not list another user's documents", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const id = await createDocument(owner.id, "Owned", "body");
    const mine = await listDocuments(other.id);
    expect(mine.find((d) => d.id === id)).toBeUndefined();
    await prisma.document.delete({ where: { id } });
  });

  it("records source and agentContext", async () => {
    const user = await makeUser();
    const id = await createDocument(user.id, "Plan", "body", { source: "CLAUDE_CODE", agentContext: "ctx" });
    const detail = await getDocumentDetail(id);
    expect(detail?.source).toBe("CLAUDE_CODE");
    expect(detail?.agentContext).toBe("ctx");
    await prisma.document.delete({ where: { id } });
  });

  it("seeds an owner participant row on create", async () => {
    const user = await makeUser();
    const id = await createDocument(user.id, "Plan", "body");
    const row = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: id, userId: user.id } },
    });
    expect(row).toBeTruthy();
    await prisma.document.delete({ where: { id } });
  });

  it("getDocumentDetail exposes versions and per-annotation createdOnVersion", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}-prov`, name: "Alex", email: `u-${Date.now()}-prov@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "c");
    const detail = await getDocumentDetail(docId);
    expect(detail?.versions?.[0]?.versionNumber).toBe(1);
    expect(detail?.versions?.[0]?.createdBy?.name).toBe("Alex");
    expect(detail?.annotations?.[0]?.createdOnVersion?.versionNumber).toBe(1);
    await prisma.document.delete({ where: { id: docId } });
  });
});
