import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument, getDocumentDetail, listDocuments } from "@/lib/documents";

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
    const all = await listDocuments();
    expect(all.find((d) => d.id === id)).toBeTruthy();
    await prisma.document.delete({ where: { id } });
  });
});
