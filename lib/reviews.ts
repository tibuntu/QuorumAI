import { prisma } from "@/lib/db";
import { computeDocumentState } from "@/lib/review-state";
import type { ReviewVerdict } from "@/lib/enums";

export async function submitReview(userId: string, documentId: string, verdict: ReviewVerdict) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true, requiredApprovals: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");

  // One active verdict per reviewer for the current version: replace any prior.
  await prisma.review.deleteMany({ where: { documentId, reviewerId: userId } });
  await prisma.review.create({ data: { documentId, reviewerId: userId, verdict, onVersionId: doc.currentVersionId } });

  const reviews = await prisma.review.findMany({ where: { documentId } });
  const state = computeDocumentState(reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed })), doc.requiredApprovals);
  await prisma.document.update({ where: { id: documentId }, data: { state } });
  return state;
}
