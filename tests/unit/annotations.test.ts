import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation, addComment, setThreadStatus, applySuggestion, OrphanedAnchorError } from "@/lib/annotations";
import { ConcurrencyError, getVersionMarkdown, createVersion } from "@/lib/versions";
import { buildQuote } from "@/lib/anchoring";
import { SEVERITIES } from "@/lib/enums";

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

  it("persists severity and category when provided", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}-sev`, name: "U", email: `u-${Date.now()}-sev@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(
      user.id,
      docId,
      { quote: buildQuote(md, start, start + "cloud setup".length), startOffset: start, endOffset: start + 11, severity: "BLOCKER", category: "security" },
      "infra concern"
    );
    const loaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(loaded?.severity).toBe("BLOCKER");
    expect(loaded?.category).toBe("security");
    await prisma.document.delete({ where: { id: docId } });
  });

  it("defaults severity and category to null", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}-nul`, name: "U", email: `u-${Date.now()}-nul@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "x");
    const loaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(loaded?.severity).toBeNull();
    expect(loaded?.category).toBeNull();
    await prisma.document.delete({ where: { id: docId } });
  });

  it("SEVERITIES is the canonical set", () => {
    expect([...SEVERITIES]).toEqual(["BLOCKER", "MAJOR", "MINOR", "NIT"]);
  });
});

describe("applySuggestion", () => {
  async function setup(markdown: string) {
    const now = new Date();
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const user = await prisma.user.create({
      data: { id: `s-${suffix}`, email: `s-${suffix}@e.com`, name: "S", emailVerified: false, createdAt: now, updatedAt: now },
    });
    const docId = await createDocument(user.id, "Plan", markdown);
    return { userId: user.id, docId };
  }

  function suggestAnchor(md: string, phrase: string, suggestedText: string) {
    const start = md.indexOf(phrase);
    if (start === -1) throw new Error(`phrase not found in markdown: ${phrase}`);
    return {
      quote: buildQuote(md, start, start + phrase.length),
      startOffset: start,
      endOffset: start + phrase.length,
      kind: "SUGGESTION" as const,
      suggestedText,
    };
  }

  it("replaces exactly the anchored span and creates a new version", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");

    const result = await applySuggestion(userId, ann.id, 1);

    expect(result.version.versionNumber).toBe(2);
    const v2 = await getVersionMarkdown(docId, 2);
    expect(v2).toBe("The k8s cluster needs review.");
    const reloaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(reloaded?.threadStatus).toBe("RESOLVED");
    expect(reloaded?.appliedInVersionId).toBe(result.version.id);
  });

  it("re-resolves a MOVED anchor and applies at the relocated span", async () => {
    const md = "Intro line.\n\nThe cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    await createVersion(userId, docId, 1, "Intro line, expanded a lot.\n\nThe cloud setup needs review.");

    const result = await applySuggestion(userId, ann.id, 2);
    const latest = await getVersionMarkdown(docId, 3);
    expect(latest).toContain("The k8s cluster needs review.");
    expect(result.version.versionNumber).toBe(3);
  });

  it("blocks apply when the anchor is ORPHANED", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    await createVersion(userId, docId, 1, "Totally different content now.");

    await expect(applySuggestion(userId, ann.id, 2)).rejects.toBeInstanceOf(OrphanedAnchorError);
    const reloaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(reloaded?.appliedInVersionId).toBeNull();
  });

  it("rejects a stale baseVersionNumber with ConcurrencyError", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    await createVersion(userId, docId, 1, "The cloud setup needs review. (touched)");

    await expect(applySuggestion(userId, ann.id, 1)).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("applies a no-op suggestion (text equals span) without creating a new version", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "cloud setup"), "no change");

    const result = await applySuggestion(userId, ann.id, 1);

    expect(result.version.versionNumber).toBe(1);
    const versions = await prisma.documentVersion.count({ where: { documentId: docId } });
    expect(versions).toBe(1);
    const reloaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(reloaded?.threadStatus).toBe("RESOLVED");
    expect(reloaded?.appliedInVersionId).not.toBeNull();
  });

  it("refuses to apply a rejected (RESOLVED) suggestion", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    await setThreadStatus(userId, ann.id, "RESOLVED"); // reject

    await expect(applySuggestion(userId, ann.id, 1)).rejects.toThrow(/resolved/);
    const reloaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(reloaded?.appliedInVersionId).toBeNull();
  });

  it("rejects non-suggestion and already-applied annotations", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const comment = await createAnnotation(userId, docId, {
      quote: buildQuote(md, 4, 15), startOffset: 4, endOffset: 15,
    }, "just a comment");
    await expect(applySuggestion(userId, comment.id, 1)).rejects.toThrow();

    const sugg = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    await applySuggestion(userId, sugg.id, 1);
    await expect(applySuggestion(userId, sugg.id, 2)).rejects.toThrow(/already applied/);
  });
});
