import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { relocate } from "@/lib/anchoring";
import { computeDocumentState } from "@/lib/review-state";
import { publish } from "@/lib/events";
import type { ReviewVerdict } from "@/lib/enums";

export class ConcurrencyError extends Error {
  constructor(message = "stale base version") {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export interface ReanchorSummary {
  active: number;
  moved: number;
  orphaned: number;
}

export async function createVersion(userId: string, documentId: string, baseVersionNumber: number, markdown: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { currentVersion: true } });
  if (!doc?.currentVersion) throw new Error("document has no current version");
  if (doc.currentVersion.versionNumber !== baseVersionNumber) throw new ConcurrencyError();

  const contentHash = createHash("sha256").update(markdown).digest("hex");
  if (contentHash === doc.currentVersion.contentHash) return { unchanged: true as const };

  const version = await prisma.documentVersion.create({
    data: {
      documentId,
      versionNumber: doc.currentVersion.versionNumber + 1,
      markdown,
      contentHash,
      createdById: userId,
    },
  });
  await prisma.document.update({ where: { id: documentId }, data: { currentVersionId: version.id } });

  // Re-anchor every annotation against the new markdown.
  const annotations = await prisma.annotation.findMany({ where: { documentId } });
  const summary: ReanchorSummary = { active: 0, moved: 0, orphaned: 0 };
  for (const a of annotations) {
    const result = relocate(markdown, { exact: a.anchorExact ?? "", prefix: a.anchorPrefix ?? "", suffix: a.anchorSuffix ?? "" });
    if (result.status === "ACTIVE") summary.active++;
    else if (result.status === "MOVED") summary.moved++;
    else summary.orphaned++;
    await prisma.annotation.update({
      where: { id: a.id },
      data: { status: result.status, startOffset: result.range?.start ?? null, endOffset: result.range?.end ?? null },
    });
  }

  // Any content change dismisses all active approvals.
  await prisma.review.updateMany({ where: { documentId, verdict: "APPROVE", dismissed: false }, data: { dismissed: true } });

  // Recompute state.
  const reviews = await prisma.review.findMany({ where: { documentId } });
  const state = computeDocumentState(
    reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed })),
    doc.requiredApprovals
  );
  await prisma.document.update({ where: { id: documentId }, data: { state } });

  publish(documentId, { type: "version.created", versionNumber: version.versionNumber, summary });
  return { unchanged: false as const, version, summary, state };
}
