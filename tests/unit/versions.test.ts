import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { submitReview } from "@/lib/reviews";
import { buildQuote } from "@/lib/anchoring";
import { createVersion, ConcurrencyError, listVersions, getVersionMarkdown } from "@/lib/versions";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

const V1 = "The quick brown fox jumps over the lazy dog. Sphinx of black quartz judge my vow. Pack my box with five dozen liquor jugs.";
const V2 = "The quick brown fox jumps over the lazy dog. Sphinx of white quartz judge my vow.";

function quoteFor(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  return { quote: buildQuote(text, start, start + phrase.length), startOffset: start, endOffset: start + phrase.length };
}

describe("versions service", () => {
  it("rejects a stale base version", async () => {
    const user = await makeUser();
    const docId = await createDocument(user.id, "Doc", V1);
    await expect(createVersion(user.id, docId, 99, V2)).rejects.toBeInstanceOf(ConcurrencyError);
    await prisma.document.delete({ where: { id: docId } });
  });

  it("no-ops on unchanged content", async () => {
    const user = await makeUser();
    const docId = await createDocument(user.id, "Doc", V1);
    const res = await createVersion(user.id, docId, 1, V1);
    expect(res).toEqual({ unchanged: true });
    await prisma.document.delete({ where: { id: docId } });
  });

  it("re-anchors, dismisses approvals, recomputes state", async () => {
    const author = await makeUser();
    const reviewer = await makeUser();
    const docId = await createDocument(author.id, "Doc", V1);
    await createAnnotation(author.id, docId, quoteFor(V1, "quick brown fox"), "stays");
    await createAnnotation(author.id, docId, quoteFor(V1, "Sphinx of black quartz"), "edited");
    await createAnnotation(author.id, docId, quoteFor(V1, "five dozen liquor jugs"), "deleted");
    await submitReview(reviewer.id, docId, "APPROVE");

    const res = await createVersion(author.id, docId, 1, V2);
    expect(res.unchanged).toBe(false);
    if (res.unchanged) throw new Error("unreachable");
    expect(res.summary).toEqual({ active: 1, moved: 1, orphaned: 1 });
    expect(res.state).toBe("OPEN");

    const reviews = await prisma.review.findMany({ where: { documentId: docId } });
    expect(reviews.every((r) => r.dismissed)).toBe(true);

    await prisma.document.delete({ where: { id: docId } });
  });
});

describe("version read helpers", () => {
  it("listVersions returns metadata newest-first", async () => {
    const user = await makeUser();
    const docId = await createDocument(user.id, "Doc", "v1 content here");
    await createVersion(user.id, docId, 1, "v2 content here");

    const list = await listVersions(docId);
    expect(list.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(list[0].createdBy.name).toBeTruthy();
    expect(list[0].contentHash).toBeTruthy();

    await prisma.document.delete({ where: { id: docId } });
  });

  it("getVersionMarkdown returns snapshot or null", async () => {
    const user = await makeUser();
    const docId = await createDocument(user.id, "Doc", "v1 content here");
    await createVersion(user.id, docId, 1, "v2 content here");

    expect(await getVersionMarkdown(docId, 1)).toContain("v1 content");
    expect(await getVersionMarkdown(docId, 2)).toContain("v2 content");
    expect(await getVersionMarkdown(docId, 999)).toBeNull();

    await prisma.document.delete({ where: { id: docId } });
  });
});
