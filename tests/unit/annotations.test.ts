import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation, addComment, setThreadStatus } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";

describe("annotations service", () => {
  it("creates, replies, resolves", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}`, name: "U", email: `u-${Date.now()}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + "cloud setup".length), startOffset: start, endOffset: start + 11 }, "infra concern");
    await addComment(user.id, ann.id, "agree");
    await setThreadStatus(user.id, ann.id, "RESOLVED");
    const loaded = await prisma.annotation.findUnique({ where: { id: ann.id }, include: { comments: true } });
    expect(loaded?.comments).toHaveLength(2);
    expect(loaded?.threadStatus).toBe("RESOLVED");
    await prisma.document.delete({ where: { id: docId } });
  });
});
